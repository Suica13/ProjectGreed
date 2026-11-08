package io.projectgreed.apptest2;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.channels.FileChannel;

/** Separate recording files; supports both private app storage and the selected SAF tree. */
final class LocalArchive {
    private final File local;
    private final ContentResolver resolver;
    private final Uri tree;
    LocalArchive(File local) { this.local=local; resolver=null; tree=null; }
    LocalArchive(ContentResolver resolver, Uri tree) { this.resolver=resolver; this.tree=tree; local=null; }
    private static void validate(String id) throws IOException {
        if(id==null || !id.matches("[a-zA-Z0-9_-]{1,120}"))throw new IOException("记录ID无效");
    }
    private Uri find(Uri parent,String name) throws Exception {
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(parent));
        try(Cursor rows=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
            if(rows==null)throw new IOException("无法访问记录目录，请重新授权存档文件夹");
            Uri found=null;
            while(rows.moveToNext())if(name.equals(rows.getString(1))){
                if(found!=null)throw new IOException("记录文件名重复");
                found=DocumentsContract.buildDocumentUriUsingTree(tree,rows.getString(0));
            }
            return found;
        }
    }
    private Uri directory() throws Exception {
        Uri parent=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        Uri dir=find(parent,"records");
        if(dir==null)dir=DocumentsContract.createDocument(resolver,parent,DocumentsContract.Document.MIME_TYPE_DIR,"records");
        if(dir==null)throw new IOException("无法创建记录目录");return dir;
    }
    private Uri document(String name,boolean create) throws Exception {
        Uri parent=directory(),file=find(parent,name);
        if(file==null&&create)file=DocumentsContract.createDocument(resolver,parent,"application/octet-stream",name);
        if(file==null&&create)throw new IOException("无法创建记录文件");return file;
    }
    private InputStream input(String name) throws Exception {
        if(local!=null)return new FileInputStream(new File(local,name));
        Uri file=document(name,false);if(file==null)throw new FileNotFoundException(name);
        InputStream in=resolver.openInputStream(file);if(in==null)throw new IOException("无法读取记录文件");return in;
    }
    private JSONObject metadata(String id) throws Exception {
        try(InputStream in=input(id+".meta.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>65536)throw new IOException("记录索引损坏");}
            return new JSONObject(out.toString("UTF-8"));
        }catch(FileNotFoundException e){return null;}
    }
    private void writeMeta(String id,JSONObject meta) throws Exception {
        byte[] data=meta.toString().getBytes(StandardCharsets.UTF_8);String name=id+".meta.json";
        if(local!=null){
            File file=new File(local,name),temp=new File(local,name+".tmp");
            try(FileOutputStream out=new FileOutputStream(temp)){out.write(data);out.flush();out.getFD().sync();}
            Files.move(temp.toPath(),file.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);
        }else{
            try(ParcelFileDescriptor fd=resolver.openFileDescriptor(document(name,true),"rwt")){
                if(fd==null)throw new IOException("无法保存记录索引");
                try(FileOutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(fd)){out.write(data);out.flush();out.getFD().sync();}
            }
        }
    }
    private void remove(String name) throws Exception {
        if(local!=null){File file=new File(local,name);if(file.exists()&&!file.delete())throw new IOException("无法删除旧记录");}
        else{Uri file=document(name,false);if(file!=null&&!DocumentsContract.deleteDocument(resolver,file))throw new IOException("无法删除旧记录");}
    }
    synchronized String request(String text){
        try{
            if(text.length()>1024*1024)throw new IOException("单次记录数据过大");
            JSONObject q=new JSONObject(text);String op=q.getString("op");
            if(local!=null&&!local.isDirectory()&&!local.mkdirs())throw new IOException("无法创建记录目录");
            if(op.equals("list")){
                JSONArray items=new JSONArray();
                if(local!=null){String[] names=local.list();if(names==null)throw new IOException("无法读取记录目录");for(String name:names)if(name.endsWith(".meta.json")){String id=name.substring(0,name.length()-10);validate(id);items.put(metadata(id));}}
                else{
                    Uri dir=directory(),children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(dir));
                    try(Cursor rows=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
                        if(rows==null)throw new IOException("无法读取记录目录");while(rows.moveToNext()){String name=rows.getString(0);if(name.endsWith(".meta.json")){String id=name.substring(0,name.length()-10);validate(id);items.put(metadata(id));}}
                    }
                }
                return new JSONObject().put("ok",true).put("items",items).toString();
            }
            String id=q.getString("id"),kind=q.getString("kind");validate(id);
            if(!kind.equals("log")&&!kind.equals("replay"))throw new IOException("记录类型无效");
            String name=id+(kind.equals("log")?".log.txt":".replay.greed");JSONObject old=metadata(id);
            if(old!=null&&!old.getString("kind").equals(kind))throw new IOException("记录类型不一致");
            if(op.equals("remove")){remove(name);remove(id+".meta.json");return "{\"ok\":true}";}
            long offset=q.getLong("offset");if(offset<0)throw new IOException("记录位置无效");
            if(op.equals("read")){
                if(old==null)throw new IOException("记录不存在");
                try(InputStream in=input(name);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                    long left=offset;while(left>0){long n=in.skip(left);if(n<=0){if(in.read()==-1)throw new IOException("记录位置超出范围");n=1;}left-=n;}
                    byte[] buf=new byte[16384];int n;while(bytes.size()<262144&&(n=in.read(buf,0,Math.min(buf.length,262144-bytes.size())))!=-1)bytes.write(buf,0,n);
                    return new JSONObject().put("ok",true).put("data",Base64.getEncoder().encodeToString(bytes.toByteArray())).toString();
                }
            }
            if(!op.equals("write"))throw new IOException("记录操作无效");
            if(offset!=(old==null?0:old.getLong("bytes")))throw new IOException("记录写入位置不一致");
            byte[] data=Base64.getDecoder().decode(q.getString("data"));if(data.length>262144)throw new IOException("记录数据块过大");
            if(local!=null){
                try(RandomAccessFile file=new RandomAccessFile(new File(local,name),"rw")){
                    if(file.length()<offset)throw new IOException("记录内容不完整");file.setLength(offset);file.seek(offset);file.write(data);file.getFD().sync();
                }
            }else{
                try(ParcelFileDescriptor fd=resolver.openFileDescriptor(document(name,true),"rw")){
                    if(fd==null)throw new IOException("无法写入记录文件");
                    try(FileOutputStream out=new ParcelFileDescriptor.AutoCloseOutputStream(fd)){
                        FileChannel channel=out.getChannel();if(channel.size()<offset)throw new IOException("记录内容不完整");channel.truncate(offset);channel.position(offset);out.write(data);out.flush();out.getFD().sync();
                    }
                }
            }
            JSONObject meta=q.getJSONObject("meta").put("id",id).put("kind",kind).put("bytes",offset+data.length).put("updatedAt",System.currentTimeMillis());
            writeMeta(id,meta);return new JSONObject().put("ok",true).put("meta",meta).toString();
        }catch(Exception error){try{return new JSONObject().put("ok",false).put("error",error.getMessage()).toString();}catch(Exception ignored){return "{\"ok\":false,\"error\":\"记录保存失败\"}";}}
    }
}
