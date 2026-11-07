package io.projectgreed.apptest2;

import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/** A verified snapshot and previous revision in the selected native storage backend. */
final class NativeStore {
    static final int MAX_BYTES = 64 * 1024 * 1024;
    private final SnapshotFiles files;
    private static final String PRIMARY = "profile.json", BACKUP = "profile.previous.json";
    private JSONObject current;
    private boolean recovered;
    private String readError;
    NativeStore(File directory) { this(new SnapshotFiles.Local(directory), false, null); }
    NativeStore(SnapshotFiles files, boolean requireExisting, JSONObject seed) {
        this.files = files;
        try {
            if (files.exists(PRIMARY)) current = load(PRIMARY);
            else if (files.exists(BACKUP)) { current = load(BACKUP); recovered = true; }
            else {
                if (requireExisting) throw new IOException("所选文件夹中的存档已不存在，请重新选择原存档文件夹");
                current = new JSONObject().put("format", "ProjectGreed-app-store").put("version", 1)
                    .put("revision", seed == null ? 0 : seed.getLong("revision"))
                    .put("values", seed == null ? new JSONObject() : seed.getJSONObject("values"));
                validateValues(current.getJSONObject("values"));
            }
        } catch (Exception first) {
            try {
                current = load(BACKUP);
                if (files.exists(PRIMARY)) files.preserveDamaged(PRIMARY);
                write(PRIMARY, current);
                recovered = true;
            } catch (Exception ignored) { readError = "存档及备份未能读取：" + first.getMessage(); }
        }
    }
    // Test the selected folder before persisting its URI as the authoritative location.
    synchronized void ensureSaved() throws Exception {
        if (readError != null) throw new IOException(readError);
        write(BACKUP, current);
        write(PRIMARY, current);
    }
    private JSONObject load(String name) throws Exception {
        try (InputStream input = files.openRead(name); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16384]; int n;
            while ((n = input.read(buffer)) != -1) {
                if (bytes.size() + n > MAX_BYTES) throw new IOException("Profile exceeds 64 MiB");
                bytes.write(buffer, 0, n);
            }
            JSONObject result = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            if (!"ProjectGreed-app-store".equals(result.getString("format")) || result.getInt("version") != 1 || result.getLong("revision") < 0)
                throw new IOException("Invalid native profile");
            validateValues(result.getJSONObject("values"));
            return result;
        }
    }
    private static void validateValues(JSONObject values) throws Exception {
        for (Iterator<String> keys = values.keys(); keys.hasNext();) {
            String key = keys.next();
            if (key.length() > 512 || !(values.get(key) instanceof String)) throw new IOException("Invalid profile record");
        }
    }
    private void write(String name, JSONObject value) throws Exception {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("应用存档超过64 MiB64 MiB");
        files.write(name, bytes);
        // A provider may report success after a partial write. Never acknowledge it.
        if (!load(name).toString().equals(value.toString())) throw new IOException("Native save verification failed");
    }
    synchronized String read() {
        try {
            if (readError != null) throw new IOException(readError);
            return new JSONObject().put("ok", true).put("revision", current.getLong("revision"))
                .put("values", current.getJSONObject("values")).put("recovered", recovered).toString();
        } catch (Exception error) { return failure(error); }
    }
    synchronized String commit(String text) {
        try {
            if (readError != null) throw new IOException(readError);
            if (text.length() > MAX_BYTES) throw new IOException("应用存档超过64 MiB");
            JSONObject request = new JSONObject(text);
            if (request.getLong("revision") != current.getLong("revision")) throw new IOException("存档版本冲突，请重启客户端");
            JSONObject values = request.getJSONObject("values");
            validateValues(values);
            JSONObject next = new JSONObject().put("format", "ProjectGreed-app-store").put("version", 1)
                .put("revision", current.getLong("revision") + 1).put("values", values);
            // Preserve a validated previous snapshot; never acknowledge a half-written purchase.
            write(BACKUP, current);
            write(PRIMARY, next);
            current = next;
            return new JSONObject().put("ok", true).put("revision", current.getLong("revision")).toString();
        } catch (Exception error) { return failure(error); }
    }
    private static String failure(Exception error) {
        try { return new JSONObject().put("ok", false).put("error", "本地文件保存或读取失败：" + error.getMessage()).toString(); }
        catch (Exception ignored) { return "{\"ok\":false,\"error\":\"Native storage failed\"}"; }
    }
}
