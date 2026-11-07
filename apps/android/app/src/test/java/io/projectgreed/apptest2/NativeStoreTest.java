package io.projectgreed.apptest2;

import org.junit.Test;
import static org.junit.Assert.*;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Real NativeStore logic, with provider failure modes and no Android filesystem stubs. */
public final class NativeStoreTest {
    static final class Folder implements SnapshotFiles {
        final Map<String, byte[]> documents = new HashMap<>();
        boolean unavailable, partialPrimary;
        public boolean exists(String name) throws Exception { access(); return documents.containsKey(name); }
        public InputStream openRead(String name) throws Exception {
            access(); if (!documents.containsKey(name)) throw new FileNotFoundException(name);
            return new ByteArrayInputStream(documents.get(name));
        }
        public void write(String name, byte[] bytes) throws Exception {
            access(); documents.put(name, partialPrimary && name.equals("profile.json") ? "broken".getBytes(StandardCharsets.UTF_8) : bytes.clone());
        }
        public void preserveDamaged(String name) { documents.put("damaged", documents.remove(name)); }
        void access() throws Exception { if (unavailable) throw new IOException("permission revoked"); }
    }
    static JSONObject read(NativeStore store) throws Exception { return new JSONObject(store.read()); }
    static JSONObject seed(long revision, String money) throws Exception {
        return new JSONObject().put("ok",true).put("revision",revision).put("values",new JSONObject().put("wallet",money).put("name","驾驶员😀"));
    }
    static JSONObject commit(NativeStore store, long revision, String money) throws Exception {
        return new JSONObject(store.commit(seed(revision,money).toString()));
    }
    @Test public void migratesAcknowledgedSnapshotAndRestartsFromSelectedFolder() throws Exception {
        Folder folder = new Folder();
        NativeStore store = new NativeStore(folder,false,seed(17,"1000"));
        store.ensureSaved();
        assertEquals(17,read(new NativeStore(folder,true,null)).getLong("revision"));
        assertTrue(commit(store,17,"500").getBoolean("ok"));
        JSONObject restarted = read(new NativeStore(folder,true,null));
        assertEquals("500",restarted.getJSONObject("values").getString("wallet"));
        assertEquals("驾驶员😀",restarted.getJSONObject("values").getString("name"));
    }
    @Test public void existingFolderWinsOverInternalSeed() throws Exception {
        Folder folder=new Folder();new NativeStore(folder,false,seed(3,"2000")).ensureSaved();
        NativeStore selected=new NativeStore(folder,false,seed(50,"1"));selected.ensureSaved();
        assertEquals("2000",read(selected).getJSONObject("values").getString("wallet"));
        assertEquals(3,read(selected).getLong("revision"));
    }
    @Test public void missingExternalFilesNeverCreateAnEmptySave() throws Exception {
        Folder folder=new Folder();
        assertFalse(read(new NativeStore(folder,true,null)).getBoolean("ok"));
        assertTrue(folder.documents.isEmpty());
    }
    @Test public void revokedPermissionDoesNotSpendMoneyOrSwitchToInternalStorage() throws Exception {
        Folder folder=new Folder();NativeStore store=new NativeStore(folder,false,seed(2,"1000"));store.ensureSaved();
        folder.unavailable=true;
        assertFalse(commit(store,2,"0").getBoolean("ok"));
        assertEquals("1000",read(store).getJSONObject("values").getString("wallet"));
        assertFalse(read(new NativeStore(folder,true,null)).getBoolean("ok"));
        folder.unavailable=false;
        assertEquals("1000",read(new NativeStore(folder,true,null)).getJSONObject("values").getString("wallet"));
    }
    @Test public void partialProviderWriteIsRejectedAndBackupRestoresLastAcknowledgedRevision() throws Exception {
        Folder folder=new Folder();NativeStore store=new NativeStore(folder,false,seed(7,"1000"));store.ensureSaved();
        folder.partialPrimary=true;
        assertFalse(commit(store,7,"0").getBoolean("ok"));
        assertEquals(7,read(store).getLong("revision"));
        folder.partialPrimary=false;
        JSONObject restored=read(new NativeStore(folder,true,null));
        assertTrue(restored.getBoolean("recovered"));
        assertEquals("1000",restored.getJSONObject("values").getString("wallet"));
        assertTrue(folder.documents.containsKey("damaged"));
    }
    @Test public void corruptExternalFilesNeverOverwriteInternalSeedOrBadFiles() throws Exception {
        Folder folder=new Folder();folder.documents.put("profile.json","broken".getBytes(StandardCharsets.UTF_8));
        assertFalse(read(new NativeStore(folder,false,seed(20,"1000"))).getBoolean("ok"));
        assertEquals("broken",new String(folder.documents.get("profile.json"),StandardCharsets.UTF_8));
    }
    @Test public void staleRevisionIsRejectedAfterExternalRestart() throws Exception {
        Folder folder=new Folder();NativeStore store=new NativeStore(folder,false,seed(2,"1000"));store.ensureSaved();
        assertFalse(commit(store,1,"0").getBoolean("ok"));
        assertEquals(2,read(new NativeStore(folder,true,null)).getLong("revision"));
    }
}
