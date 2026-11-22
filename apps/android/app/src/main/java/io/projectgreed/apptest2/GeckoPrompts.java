package io.projectgreed.apptest2;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.database.Cursor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.Executors;
import org.mozilla.geckoview.*;

/** Android dialogs and document pickers used by Gecko's HTML inputs. */
final class GeckoPrompts implements GeckoSession.PromptDelegate {
    private final Activity activity;
    private FilePrompt filePrompt;
    private GeckoResult<PromptResponse> fileResult;
    private final java.util.concurrent.ExecutorService fileReader = Executors.newSingleThreadExecutor();
    GeckoPrompts(Activity activity) { this.activity = activity; }
    @Override public GeckoResult<PromptResponse> onAlertPrompt(GeckoSession session, AlertPrompt prompt) {
        GeckoResult<PromptResponse> result = new GeckoResult<>();
        new AlertDialog.Builder(activity).setMessage(prompt.message)
            .setPositiveButton("确定", (d,w)->result.complete(prompt.dismiss()))
            .setOnCancelListener(d->result.complete(prompt.dismiss())).show();
        return result;
    }
    @Override public GeckoResult<PromptResponse> onButtonPrompt(GeckoSession session, ButtonPrompt prompt) {
        GeckoResult<PromptResponse> result = new GeckoResult<>();
        new AlertDialog.Builder(activity).setMessage(prompt.message)
            .setPositiveButton("确定", (d,w)->result.complete(prompt.confirm(ButtonPrompt.Type.POSITIVE)))
            .setNegativeButton("取消", (d,w)->result.complete(prompt.confirm(ButtonPrompt.Type.NEGATIVE)))
            .setOnCancelListener(d->result.complete(prompt.dismiss())).show();
        return result;
    }
    @Override public GeckoResult<PromptResponse> onTextPrompt(GeckoSession session, TextPrompt prompt) {
        GeckoResult<PromptResponse> result = new GeckoResult<>();
        EditText input = new EditText(activity); input.setText(prompt.defaultValue);
        new AlertDialog.Builder(activity).setMessage(prompt.message).setView(input)
            .setPositiveButton("确定", (d,w)->result.complete(prompt.confirm(input.getText().toString())))
            .setNegativeButton("取消", (d,w)->result.complete(prompt.dismiss()))
            .setOnCancelListener(d->result.complete(prompt.dismiss())).show();
        return result;
    }
    private static void flatten(ChoicePrompt.Choice[] source, List<ChoicePrompt.Choice> output) {
        for (ChoicePrompt.Choice choice : source) {
            if (choice.items != null) flatten(choice.items,output);
            else if (!choice.separator) output.add(choice);
        }
    }
    @Override public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession session, ChoicePrompt prompt) {
        GeckoResult<PromptResponse> result = new GeckoResult<>();
        List<ChoicePrompt.Choice> choices = new ArrayList<>(); flatten(prompt.choices,choices);
        ArrayAdapter<String> adapter = new ArrayAdapter<String>(activity,android.R.layout.simple_list_item_single_choice) {
            @Override public boolean isEnabled(int position) { return !choices.get(position).disabled; }
            @Override public boolean areAllItemsEnabled() { return false; }
        };
        int selected = -1;
        for (int i=0;i<choices.size();i++) { adapter.add(choices.get(i).label); if (choices.get(i).selected) selected=i; }
        AlertDialog.Builder dialog = new AlertDialog.Builder(activity).setTitle(prompt.title)
            .setNegativeButton("取消", (d,w)->result.complete(prompt.dismiss()))
            .setOnCancelListener(d->result.complete(prompt.dismiss()));
        if (prompt.type == ChoicePrompt.Type.MULTIPLE) {
            boolean[] checked = new boolean[choices.size()];
            String[] labels = new String[choices.size()];
            for(int i=0;i<labels.length;i++){ labels[i]=choices.get(i).label; checked[i]=choices.get(i).selected; }
            dialog.setMultiChoiceItems(labels,checked,(d,i,value)->{
                checked[i]=choices.get(i).disabled ? choices.get(i).selected : value;
                ((AlertDialog)d).getListView().setItemChecked(i,checked[i]);
            }).setPositiveButton("确定",(d,w)->{
                List<String> ids=new ArrayList<>();
                for(int i=0;i<checked.length;i++) if(checked[i]) ids.add(choices.get(i).id);
                result.complete(prompt.confirm(ids.toArray(new String[0])));
            });
        } else dialog.setSingleChoiceItems(adapter,selected,(d,i)->{
            if(choices.get(i).disabled)return;
            result.complete(prompt.confirm(choices.get(i))); d.dismiss();
        });
        dialog.show(); return result;
    }
    @Override public GeckoResult<PromptResponse> onFilePrompt(GeckoSession session, FilePrompt prompt) {
        cancelFile();
        filePrompt=prompt; fileResult=new GeckoResult<>();
        GeckoResult<PromptResponse> result=fileResult;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).setType("*/*");
        if(prompt.mimeTypes!=null && prompt.mimeTypes.length>0) {
            List<String> types=new ArrayList<>();
            for(String type:prompt.mimeTypes) if(type!=null && type.contains("/")) types.add(type);
            if(types.size()==1) intent.setType(types.get(0));
            else if(!types.isEmpty()) {
                String family=types.get(0).split("/")[0];
                if(types.stream().allMatch(type->type.startsWith(family+"/"))) intent.setType(family+"/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,types.toArray(new String[0]));
            }
        }
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,prompt.type==FilePrompt.Type.MULTIPLE);
        try { activity.startActivityForResult(intent,101); }
        catch(ActivityNotFoundException | SecurityException error) {
            intent.setAction(Intent.ACTION_GET_CONTENT);
            try { activity.startActivityForResult(intent,101); }
            catch(ActivityNotFoundException | SecurityException fallbackError) {
                cancelFile(); Toast.makeText(activity,"无法打开文件选择器",Toast.LENGTH_LONG).show();
            }
        }
        return result;
    }
    void fileResult(int resultCode, Intent data) {
        if(filePrompt==null)return;
        FilePrompt prompt=filePrompt; GeckoResult<PromptResponse> result=fileResult;
        if(resultCode!=Activity.RESULT_OK || data==null) { cancelFile(); return; }
        List<Uri> uris=new ArrayList<>();
        if(data.getClipData()!=null) for(int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null) uris.add(data.getData());
        uris.removeAll(Collections.singleton(null));
        if(uris.isEmpty()) { cancelFile(); return; }
        if(prompt.type!=FilePrompt.Type.MULTIPLE) uris=new ArrayList<>(uris.subList(0,1));
        final List<Uri> selected=uris;
        // SAF and gallery providers need not expose a filesystem path. Gecko's
        // path resolver cannot read all of them; stage a private local copy.
        fileReader.execute(()->{
            List<File> copies=new ArrayList<>();
            try {
                File directory=new File(activity.getCacheDir(),"html-file-picker");
                if(!directory.isDirectory() && !directory.mkdirs()) throw new IOException("cache");
                File[] old=directory.listFiles();
                if(old!=null) for(File file:old) if(file.lastModified()<System.currentTimeMillis()-86400000L) file.delete();
                for(Uri uri:selected) {
                    String name="upload";
                    try(Cursor cursor=activity.getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)) {
                        if(cursor!=null && cursor.moveToFirst() && !cursor.isNull(0)) name=cursor.getString(0);
                    }
                    name=name.replaceAll("[^a-zA-Z0-9._-]","_");
                    if(name.length()>120) name=name.substring(name.length()-120);
                    if(!name.contains(".")) {
                        String extension=MimeTypeMap.getSingleton().getExtensionFromMimeType(activity.getContentResolver().getType(uri));
                        if(extension!=null) name+="."+extension;
                    }
                    File copy=new File(directory,UUID.randomUUID()+"-"+name);copies.add(copy);
                    try(InputStream input=activity.getContentResolver().openInputStream(uri); OutputStream output=new FileOutputStream(copy)) {
                        if(input==null) throw new IOException("unreadable");
                        byte[] buffer=new byte[32768];int count;
                        while((count=input.read(buffer))!=-1) output.write(buffer,0,count);
                    }
                }
                activity.runOnUiThread(()->{
                    if(filePrompt!=prompt) { for(File copy:copies) copy.delete();return; }
                    filePrompt=null;fileResult=null;
                    Uri[] local=copies.stream().map(Uri::fromFile).toArray(Uri[]::new);
                    result.complete(prompt.type==FilePrompt.Type.MULTIPLE ? prompt.confirm(activity,local) : prompt.confirm(activity,local[0]));
                });
            } catch(IOException | RuntimeException error) {
                for(File copy:copies) copy.delete();
                activity.runOnUiThread(()->{
                    if(filePrompt!=prompt)return;
                    cancelFile();Toast.makeText(activity,"无法读取所选文件，请重新选择",Toast.LENGTH_LONG).show();
                });
            }
        });
    }
    void cancelFile() {
        if(filePrompt!=null) { fileResult.complete(filePrompt.dismiss()); filePrompt=null; fileResult=null; }
    }
    void close() { cancelFile();fileReader.shutdownNow(); }
}
