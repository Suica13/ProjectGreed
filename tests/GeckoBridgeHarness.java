package io.projectgreed.apptest2;

import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import org.json.*;

/** Desktop Gecko integration uses the exact Android loopback transport and NativeStore. */
public final class GeckoBridgeHarness {
    public static void main(String[] args) throws Exception {
        Path content=Paths.get(args[0]), directory=Paths.get(args[1]); Files.createDirectories(directory);
        SnapshotFiles files=new SnapshotFiles(){
            public boolean exists(String name){return Files.exists(directory.resolve(name));}
            public InputStream openRead(String name)throws Exception{return Files.newInputStream(directory.resolve(name));}
            public void write(String name,byte[] bytes)throws Exception{
                Path target=directory.resolve(name), staged=directory.resolve(name+".tmp");
                try(FileOutputStream output=new FileOutputStream(staged.toFile())){output.write(bytes);output.flush();output.getFD().sync();}
                Files.move(staged,target,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
            }
            public void preserveDamaged(String name)throws Exception{Files.move(directory.resolve(name),directory.resolve(name+".corrupt"),StandardCopyOption.REPLACE_EXISTING);}
        };
        NativeStore store=new NativeStore(files,false,null);
        final boolean[] fail={false};
        try(NativeAssetServer server=new NativeAssetServer(name->{
            Path path=name.equals("gecko-bridge.js")?Paths.get("apps/android/engine-assets/gecko-bridge.js"):content.resolve(name);
            if(!Files.isRegularFile(path))throw new FileNotFoundException(name);
            return Files.newInputStream(path);
        },(method,text)->{
            JSONArray input=new JSONArray(text);
            switch(method){
                case "read":return new JSONObject(store.read()).put("epoch","gecko-test").toString();
                case "commit":
                    if(fail[0])return "{\"ok\":false,\"error\":\"Disk full fixture\"}";
                    if(!new JSONObject(input.getString(0)).optString("epoch").equals("gecko-test"))return "{\"ok\":false,\"error\":\"Epoch mismatch\"}";
                    return store.commit(input.getString(0));
                default:return "{\"ok\":true}";
            }
        })){
            System.out.println(server.url("client.html")); System.out.flush();
            BufferedReader commands=new BufferedReader(new InputStreamReader(System.in,StandardCharsets.UTF_8));String line;
            while((line=commands.readLine())!=null){
                if(line.equals("fail"))fail[0]=true;
                else if(line.equals("recover"))fail[0]=false;
                else if(line.equals("freeze"))server.event("freeze",true);
                else if(line.equals("thaw"))server.event("freeze",false);
                else if(line.equals("background"))server.event("background",true);
                else if(line.equals("foreground"))server.event("foreground",true);
                System.out.println("ACK:"+line); System.out.flush();
            }
        }
    }
}
