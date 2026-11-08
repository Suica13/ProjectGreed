package io.projectgreed.apptest2;
import org.junit.Test;
import static org.junit.Assert.*;
import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.util.Base64;
public class LocalArchiveTest {
 private JSONObject call(LocalArchive archive,JSONObject q)throws Exception{return new JSONObject(archive.request(q.toString()));}
 private JSONObject write(LocalArchive archive,String id,long offset,byte[] data)throws Exception{
  return call(archive,new JSONObject().put("op","write").put("id",id).put("kind","log").put("offset",offset).put("data",Base64.getEncoder().encodeToString(data)).put("meta",new JSONObject().put("matchId","battle").put("count",offset+1)));
 }
 @Test public void chunksSurviveRestartAndRejectedRetries()throws Exception{
  File dir=Files.createTempDirectory("pg-archive").toFile();LocalArchive archive=new LocalArchive(dir);
  try{
   byte[] first=new byte[262144];java.util.Arrays.fill(first,(byte)65);byte[] next="驾驶员😀\n".getBytes("UTF-8");
   assertTrue(write(archive,"match_team0_log",0,first).getBoolean("ok"));
   assertFalse(write(archive,"match_team0_log",0,next).getBoolean("ok"));
   assertTrue(write(archive,"match_team0_log",first.length,next).getBoolean("ok"));
   archive=new LocalArchive(dir);
   JSONObject listing=call(archive,new JSONObject().put("op","list"));assertEquals(1,listing.getJSONArray("items").length());assertEquals(first.length+next.length,listing.getJSONArray("items").getJSONObject(0).getLong("bytes"));
   JSONObject read=call(archive,new JSONObject().put("op","read").put("id","match_team0_log").put("kind","log").put("offset",first.length));
   assertArrayEquals(next,Base64.getDecoder().decode(read.getString("data")));
   assertFalse(write(archive,"../profile",0,next).getBoolean("ok"));
   JSONObject removed=call(archive,new JSONObject().put("op","remove").put("id","match_team0_log").put("kind","log"));assertTrue(removed.getBoolean("ok"));
   assertEquals(0,call(archive,new JSONObject().put("op","list")).getJSONArray("items").length());
  }finally{for(File f:dir.listFiles())f.delete();dir.delete();}
 }
 @Test public void recoveryTruncatesOnlyUncommittedTail()throws Exception{
  File dir=Files.createTempDirectory("pg-archive-tail").toFile();LocalArchive archive=new LocalArchive(dir);
  try{
   assertTrue(write(archive,"recover",0,"first".getBytes("UTF-8")).getBoolean("ok"));
   try(FileOutputStream out=new FileOutputStream(new File(dir,"recover.log.txt"),true)){out.write("uncommitted".getBytes("UTF-8"));}
   assertTrue(write(archive,"recover",5,"-next".getBytes("UTF-8")).getBoolean("ok"));
   assertEquals("first-next",new String(Files.readAllBytes(new File(dir,"recover.log.txt").toPath()),"UTF-8"));
  }finally{for(File f:dir.listFiles())f.delete();dir.delete();}
 }
}
