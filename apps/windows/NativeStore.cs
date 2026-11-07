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
        public NativeStore(string directory) {
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
}
