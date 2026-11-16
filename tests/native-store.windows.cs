using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using ProjectGreed.Client;
class NativeStoreChecks {
 static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=64*1024*1024};
 static Dictionary<string,object> Read(NativeStore store){return Json.Deserialize<Dictionary<string,object>>(store.Read());}
 static void Check(bool value,string message){if(!value)throw new Exception(message);}
 static Dictionary<string,object> Commit(NativeStore store,long revision,Dictionary<string,string> values){return Json.Deserialize<Dictionary<string,object>>(store.Commit(Json.Serialize(new {revision,values})));}
 static int Main(string[] args){
  if(args[0]=="--lock"){using(var held=new FileStream(args[1],FileMode.Open,FileAccess.Read,FileShare.Read)){Console.WriteLine("LOCKED");Console.ReadLine();}return 0;}
  string dir=args[0];Directory.CreateDirectory(dir);string file=Path.Combine(dir,"profile.json");
  var store=new NativeStore(dir);Check((bool)Read(store)["ok"],"new store");
  var values=new Dictionary<string,string>{{"wallet","1000"},{"pilots","[]"}};
  Check((bool)Commit(store,0,values)["ok"],"initial commit");
  values["wallet"]="900";values["pilots"]="[\"pilot\"]";
  Check((bool)Commit(store,1,values)["ok"],"atomic multi-key commit");
  Check(!(bool)Commit(store,0,values)["ok"],"stale revision rejected");
  using(var held=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)){
   var denied=Commit(store,2,new Dictionary<string,string>{{"wallet","0"}});
   Check(!(bool)denied["ok"],"locked file write rejected");
   Check(denied["errorName"].ToString()=="NativeStorageError","native error type preserved");
   Check(denied["storageStage"].ToString()=="原子替换存档及备份","failed stage identified");
   Check(denied["storageErrorCode"].ToString().Length==8,"native error code preserved");
  }
  var persisted=Read(new NativeStore(dir));Check(Convert.ToInt64(persisted["revision"])==2,"failure did not advance revision");
  Check(((Dictionary<string,object>)persisted["values"])["wallet"].ToString()=="900","failed purchase did not spend money");
  File.WriteAllText(file,"damaged");store=new NativeStore(dir);var recovered=Read(store);
  Check((bool)recovered["ok"]&&(bool)recovered["recovered"],"recover from backup");
  Check(Convert.ToInt64(recovered["revision"])==1,"last good revision restored");
  Check(Directory.GetFiles(dir,"profile.json.corrupt-*").Length==1,"damaged original retained");
  values=new Dictionary<string,string>{{"large",new string('x',6*1024*1024)},{"unicode","驾驶员😀"}};
  Check((bool)Commit(store,1,values)["ok"],"store over browser quota");
  persisted=Read(new NativeStore(dir));var saved=(Dictionary<string,object>)persisted["values"];
  Check(saved["large"].ToString().Length==6*1024*1024&&saved["unicode"].ToString()=="驾驶员😀","large and unicode round trip");
  string roDir=Path.Combine(dir,"readonly");Directory.CreateDirectory(roDir);
  var ro=new NativeStore(roDir);string roFile=Path.Combine(roDir,"profile.json");
  Check((bool)Commit(ro,0,new Dictionary<string,string>{{"wallet","1000"}})["ok"],"readonly fixture initial save");
  Check((bool)Commit(ro,1,new Dictionary<string,string>{{"wallet","900"}})["ok"],"readonly fixture backup");
  File.WriteAllText(roFile+".tmp","abandoned write");
  foreach(var name in new[]{roFile,roFile+".bak",roFile+".tmp"}) File.SetAttributes(name,FileAttributes.ReadOnly);
  Check((bool)Commit(ro,2,new Dictionary<string,string>{{"wallet","800"}})["ok"],"readonly own snapshots repaired");
  var roSaved=Read(new NativeStore(roDir));
  Check(Convert.ToInt64(roSaved["revision"])==3,"readonly repair committed once");
  Check(((Dictionary<string,object>)roSaved["values"])["wallet"].ToString()=="800","readonly repair persisted data");
  var roBackup=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(roFile+".bak"));
  Check(Convert.ToInt64(roBackup["revision"])==2,"readonly repair retained previous backup");
  File.WriteAllText(file,"bad");File.WriteAllText(file+".bak","bad");store=new NativeStore(dir);
  Check(!(bool)Read(store)["ok"],"two damaged snapshots fail closed");
  Check(!(bool)Commit(store,0,new Dictionary<string,string>())["ok"],"damaged data never overwritten by empty profile");
  Console.WriteLine("Native file checks passed: atomic writes, read-only snapshots, native error details, file-lock failure, backup recovery, 6 MiB storage, Unicode, fail-closed corruption");return 0;
 }
}
