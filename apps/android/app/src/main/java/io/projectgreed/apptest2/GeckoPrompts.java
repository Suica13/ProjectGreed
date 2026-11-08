package io.projectgreed.apptest2;

import android.app.*;
import android.content.*;
import android.net.Uri;
import android.widget.*;
import java.util.*;
import org.mozilla.geckoview.*;

/** Android dialogs and document pickers used by Gecko's HTML inputs. */
final class GeckoPrompts implements GeckoSession.PromptDelegate {
    private final Activity activity;
    private FilePrompt filePrompt;
    private GeckoResult<PromptResponse> fileResult;
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
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if(prompt.mimeTypes!=null && prompt.mimeTypes.length>0) {
            if(prompt.mimeTypes.length==1 && prompt.mimeTypes[0].contains("/")) intent.setType(prompt.mimeTypes[0]);
            else intent.putExtra(Intent.EXTRA_MIME_TYPES,prompt.mimeTypes);
        }
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,prompt.type==FilePrompt.Type.MULTIPLE);
        try { activity.startActivityForResult(intent,101); }
        catch(ActivityNotFoundException error) { cancelFile(); }
        return result;
    }
    void fileResult(int resultCode, Intent data) {
        if(filePrompt==null)return;
        FilePrompt prompt=filePrompt; GeckoResult<PromptResponse> result=fileResult;
        filePrompt=null; fileResult=null;
        if(resultCode!=Activity.RESULT_OK || data==null) { result.complete(prompt.dismiss()); return; }
        List<Uri> uris=new ArrayList<>();
        if(data.getClipData()!=null) for(int i=0;i<data.getClipData().getItemCount();i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if(data.getData()!=null) uris.add(data.getData());
        if(uris.isEmpty()) result.complete(prompt.dismiss());
        else result.complete(prompt.confirm(activity,uris.toArray(new Uri[0])));
    }
    void cancelFile() {
        if(filePrompt!=null) { fileResult.complete(filePrompt.dismiss()); filePrompt=null; fileResult=null; }
    }
}
