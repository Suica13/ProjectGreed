package io.projectgreed.apptest2;
import android.app.*;
import android.os.Bundle;
import java.io.*;
import org.json.JSONObject;
/** No test framework dependency; run with adb shell am instrument -w on a device. */
public final class StoreInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    private static void check(boolean condition, String name) throws Exception { if (!condition) throw new Exception(name); }
    private static void damage(File file) throws Exception {try(FileOutputStream out=new FileOutputStream(file)){out.write("broken".getBytes("UTF-8"));}}
    @Override public void onStart() {
        Bundle result=new Bundle();
        try {
            File dir=new File(getTargetContext().getFilesDir(),"store-checks-"+System.nanoTime());
            NativeStore store=new NativeStore(dir);
            check(new JSONObject(store.read()).getBoolean("ok"),"initial read");
            JSONObject values=new JSONObject().put("wallet","1000").put("pilots","[]");
            check(new JSONObject(store.commit(new JSONObject().put("revision",0).put("values",values).toString())).getBoolean("ok"),"initial commit");
            check(!new JSONObject(store.commit(new JSONObject().put("revision",0).put("values",values).toString())).getBoolean("ok"),"stale revision");
            values.put("large",new String(new char[6*1024*1024]).replace('\0','x')).put("unicode","驾驶员😀");
            check(new JSONObject(store.commit(new JSONObject().put("revision",1).put("values",values).toString())).getBoolean("ok"),"large commit");
            JSONObject saved=new JSONObject(new NativeStore(dir).read()).getJSONObject("values");
            check(saved.getString("large").length()==6*1024*1024&&saved.getString("unicode").equals("驾驶员😀"),"restart and unicode");
            damage(new File(dir,"profile.json"));
            store=new NativeStore(dir);
            JSONObject restored=new JSONObject(store.read());
            check(restored.getBoolean("ok")&&restored.getBoolean("recovered")&&restored.getLong("revision")==1,"backup recovery");
            damage(new File(dir,"profile.json"));damage(new File(dir,"profile.previous.json"));
            check(!new JSONObject(new NativeStore(dir).read()).getBoolean("ok"),"fail closed");
            File failureDir=new File(getTargetContext().getFilesDir(),"store-failure-"+System.nanoTime());
            store=new NativeStore(failureDir);
            File badTarget=new File(failureDir,"profile.json");badTarget.mkdirs();damage(new File(badTarget,"preserve.txt"));
            check(!new JSONObject(store.commit(new JSONObject().put("revision",0).put("values",new JSONObject().put("wallet","0")).toString())).getBoolean("ok"),"rename failure rejected");
            check(new JSONObject(store.read()).getLong("revision")==0,"failed write did not update memory");
            result.putString("stream","PASS: native Android storage, 6 MiB, restart, backups, Unicode, stale revisions, rename failure and corruption\n");
            finish(Activity.RESULT_OK,result);
        } catch(Exception error) {result.putString("stream","FAIL: "+error+"\n");finish(Activity.RESULT_CANCELED,result);}
    }
}
