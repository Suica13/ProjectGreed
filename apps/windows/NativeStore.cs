using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace ProjectGreed.Client {
    // Exposes only the application's own key/value file. No caller-supplied paths or shell commands.
    [ComVisible(true), ClassInterface(ClassInterfaceType.AutoDual)]
    public sealed class NativeStore {
        public const int MaxBytes = 64 * 1024 * 1024;
        private readonly string file;
        private readonly LocalArchive archive;
        private readonly object gate = new object();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = MaxBytes, RecursionLimit = 128 };
        private Snapshot current;
        private bool recovered;
        private string readError;
        public sealed class Snapshot {
            public string format { get; set; }
            public int version { get; set; }
            public long revision { get; set; }
            public Dictionary<string, string> values { get; set; }
        }
        public NativeStore(string directory) : this(directory, Path.Combine(directory, "records")) {}
        public NativeStore(string directory, string recordsDirectory) {
            archive = new LocalArchive(recordsDirectory);
            Directory.CreateDirectory(directory);
            file = Path.Combine(directory, "profile.json");
            try {
                if (File.Exists(file)) current = Load(file);
                else if (File.Exists(file + ".bak")) { current = Load(file + ".bak"); recovered = true; }
                else current = new Snapshot { format = "ProjectGreed-app-store", version = 1, revision = 0, values = new Dictionary<string, string>() };
            } catch (Exception first) {
                try {
                    current = Load(file + ".bak");
                    File.Move(file, file + ".corrupt-" + DateTime.UtcNow.ToString("yyyyMMddHHmmssfff"));
                    File.Copy(file + ".bak", file);
                    recovered = true;
                } catch { readError = "存档及备份未能读取：" + first.Message; }
            }
        }
        private Snapshot Load(string path) {
            if (new FileInfo(path).Length > MaxBytes) throw new InvalidDataException("存档超过64 MiB");
            var value = json.Deserialize<Snapshot>(File.ReadAllText(path, Encoding.UTF8));
            if (value == null || value.format != "ProjectGreed-app-store" || value.version != 1 || value.revision < 0 || value.values == null)
                throw new InvalidDataException("原生存档格式无效");
            foreach (var pair in value.values) if (pair.Value == null || pair.Key.Length > 512) throw new InvalidDataException("原生存档记录无效");
            return value;
        }
        public string Location() { return Path.GetDirectoryName(file); }
        public string Archive(string request) { return archive.Request(request); }
        public string Read() {
            lock (gate) {
                if (readError != null) return json.Serialize(new { ok = false, error = readError });
                return json.Serialize(new { ok = true, revision = current.revision, values = current.values, recovered });
            }
        }
        public string Commit(string text) {
            lock (gate) {
                try {
                    if (readError != null) throw new IOException(readError);
                    var request = json.Deserialize<Snapshot>(text);
                    if (request == null || request.revision != current.revision || request.values == null)
                        throw new InvalidDataException("存档版本冲突，请重启客户端");
                    foreach (var pair in request.values) if (pair.Value == null || pair.Key.Length > 512) throw new InvalidDataException("存档记录无效");
                    var next = new Snapshot { format = "ProjectGreed-app-store", version = 1, revision = current.revision + 1, values = request.values };
                    var bytes = new UTF8Encoding(false).GetBytes(json.Serialize(next));
                    if (bytes.Length > MaxBytes) throw new IOException("应用存档超过64 MiB，请导出并整理大型备份");
                    var temp = file + ".tmp";
                    using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) {
                        stream.Write(bytes, 0, bytes.Length);
                        stream.Flush(true);
                    }
                    if (File.Exists(file)) File.Replace(temp, file, file + ".bak", true);
                    else File.Move(temp, file);
                    current = next;
                    return json.Serialize(new { ok = true, revision = next.revision });
                } catch (Exception error) {
                    try { File.Delete(file + ".tmp"); } catch { }
                    return json.Serialize(new { ok = false, error = "本地文件保存失败，未确认本次更改：" + error.Message });
                }
            }
        }
    }

    // A separate append-only archive. JavaScript supplies IDs, never filesystem paths.
    internal sealed class LocalArchive {
        private readonly string directory;
        private readonly object gate = new object();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
        public LocalArchive(string directory) { this.directory = Path.GetFullPath(directory); }
        private static void ValidateId(string id) {
            if (id == null || !System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-zA-Z0-9_-]{1,120}$")) throw new IOException("记录ID无效");
        }
        private string MetaPath(string id) { ValidateId(id); return Path.Combine(directory, id + ".meta.json"); }
        private Dictionary<string, object> Metadata(string id) {
            var file = MetaPath(id);
            return File.Exists(file) ? json.Deserialize<Dictionary<string, object>>(File.ReadAllText(file, Encoding.UTF8)) : null;
        }
        private void WriteMeta(string id, Dictionary<string, object> meta) {
            var file = MetaPath(id); var temp = file + ".tmp";
            using(var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) {
                var bytes = new UTF8Encoding(false).GetBytes(json.Serialize(meta)); stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
            }
            if(File.Exists(file)) File.Replace(temp, file, null); else File.Move(temp, file);
        }
        public string Request(string text) {
            lock(gate) try {
                if(text.Length > 1024 * 1024) throw new IOException("单次记录数据过大");
                var q=json.Deserialize<Dictionary<string,object>>(text); string op=Convert.ToString(q["op"]);
                Directory.CreateDirectory(directory);
                if(op == "list") {
                    var items=new List<Dictionary<string,object>>();
                    foreach(var file in Directory.GetFiles(directory,"*.meta.json")) {
                        var id=Path.GetFileName(file); id=id.Substring(0,id.Length-10); ValidateId(id); items.Add(Metadata(id));
                    }
                    return json.Serialize(new {ok=true,items});
                }
                string recordId=Convert.ToString(q["id"]), kind=Convert.ToString(q["kind"]); ValidateId(recordId);
                if(kind != "log" && kind != "replay") throw new IOException("记录类型无效");
                string path=Path.Combine(directory,recordId+(kind == "log"?".log.txt":".replay.greed"));
                var old=Metadata(recordId);
                if(old != null && Convert.ToString(old["kind"]) != kind) throw new IOException("记录类型不一致");
                if(op == "remove") { File.Delete(path); File.Delete(MetaPath(recordId)); return "{\"ok\":true}"; }
                long offset=Convert.ToInt64(q["offset"]);
                if(offset < 0) throw new IOException("记录位置无效");
                if(op == "read") {
                    if(old == null) throw new IOException("记录不存在");
                    using(var stream=File.OpenRead(path)) {
                        stream.Position=offset; var bytes=new byte[262144]; int n=stream.Read(bytes,0,bytes.Length);
                        return json.Serialize(new {ok=true,data=Convert.ToBase64String(bytes,0,n)});
                    }
                }
                if(op != "write") throw new IOException("记录操作无效");
                if(offset != (old == null?0:Convert.ToInt64(old["bytes"]))) throw new IOException("记录写入位置不一致");
                var data=Convert.FromBase64String(Convert.ToString(q["data"]));
                if(data.Length > 262144) throw new IOException("记录数据块过大");
                using(var stream=new FileStream(path,FileMode.OpenOrCreate,FileAccess.Write,FileShare.None)) {
                    if(stream.Length < offset) throw new IOException("记录内容不完整");
                    stream.SetLength(offset); stream.Position=offset; stream.Write(data,0,data.Length); stream.Flush(true);
                }
                var meta=(Dictionary<string,object>)q["meta"]; meta["id"]=recordId;meta["kind"]=kind;meta["bytes"]=offset+data.Length;
                meta["updatedAt"]=(long)(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds;
                WriteMeta(recordId,meta);return json.Serialize(new {ok=true,meta});
            } catch(Exception error) { return json.Serialize(new {ok=false,error=error.Message}); }
        }
    }
}
