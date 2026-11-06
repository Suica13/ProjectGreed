package io.projectgreed.apptest2;

import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/** One atomic, private app file. The web client never supplies filesystem paths. */
final class NativeStore {
    static final int MAX_BYTES = 64 * 1024 * 1024;
    private final File file, backup;
    private JSONObject current;
    private boolean recovered;
    private String readError;
    NativeStore(File directory) {
        directory.mkdirs();
        file = new File(directory, "profile.json");
        backup = new File(directory, "profile.previous.json");
        try {
            // AtomicFile.openRead also restores an interrupted platform-level write.
            if (file.exists() || new File(file.getPath() + ".bak").exists()) current = load(file);
            else if (backup.exists()) { current = load(backup); recovered = true; }
            else current = new JSONObject().put("format", "ProjectGreed-app-store").put("version", 1)
                .put("revision", 0).put("values", new JSONObject());
        } catch (Exception first) {
            try {
                current = load(backup);
                if (file.exists() && !file.renameTo(new File(directory, "profile.corrupt-" + System.currentTimeMillis() + ".json")))
                    throw new IOException("Cannot preserve damaged profile");
                write(file, current);
                recovered = true;
            } catch (Exception ignored) { readError = "存档及备份未能读取：" + first.getMessage(); }
        }
    }
    private static JSONObject load(File file) throws Exception {
        AtomicFile atomic = new AtomicFile(file);
        try (InputStream input = atomic.openRead(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
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
    private static void write(File file, JSONObject value) throws Exception {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("应用存档超过64 MiB");
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream stream = null;
        try {
            stream = atomic.startWrite(); stream.write(bytes); stream.flush(); stream.getFD().sync(); atomic.finishWrite(stream); stream = null;
            // Some AtomicFile rename failures are logged by Android instead of thrown.
            // Read back the snapshot before acknowledging a paid purchase.
            if (!load(file).toString().equals(value.toString())) throw new IOException("Native save verification failed");
        }
        catch (Exception error) { if (stream != null) atomic.failWrite(stream); throw error; }
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
            write(backup, current);
            write(file, next);
            current = next;
            return new JSONObject().put("ok", true).put("revision", current.getLong("revision")).toString();
        } catch (Exception error) { return failure(error); }
    }
    private static String failure(Exception error) {
        try { return new JSONObject().put("ok", false).put("error", "本地文件保存或读取失败：" + error.getMessage()).toString(); }
        catch (Exception ignored) { return "{\"ok\":false,\"error\":\"Native storage failed\"}"; }
    }
}
