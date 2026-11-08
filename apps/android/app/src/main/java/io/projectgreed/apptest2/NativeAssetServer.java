package io.projectgreed.apptest2;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

/** Private loopback transport for bundled resources and acknowledged native saves. */
final class NativeAssetServer implements Closeable {
    interface Assets { InputStream open(String name) throws IOException; }
    interface Calls { String call(String method, String arguments) throws Exception; }
    private static final int MAX_BODY = 90 * 1024 * 1024;
    private final Assets assets;
    private final Calls calls;
    private final ServerSocket listener;
    private final ExecutorService workers = Executors.newFixedThreadPool(8);
    private final Set<Socket> sockets = ConcurrentHashMap.newKeySet();
    private final Set<BlockingQueue<String>> events = ConcurrentHashMap.newKeySet();
    private final String token, prefix, origin;
    private volatile boolean closed;

    NativeAssetServer(Assets assets, Calls calls) throws IOException {
        this.assets = assets;
        this.calls = calls;
        byte[] secret = new byte[32]; new SecureRandom().nextBytes(secret);
        StringBuilder encoded = new StringBuilder();
        for (byte value : secret) encoded.append(String.format(Locale.ROOT, "%02x", value & 255));
        token = encoded.toString(); prefix = "/" + token + "/";
        listener = new ServerSocket(0, 32, InetAddress.getByName("127.0.0.1"));
        origin = "http://127.0.0.1:" + listener.getLocalPort();
        Thread accept = new Thread(() -> {
            while (!closed) {
                try {
                    Socket socket = listener.accept();
                    if (sockets.size() >= 32) { socket.close(); continue; }
                    sockets.add(socket);
                    workers.execute(() -> serve(socket));
                } catch (IOException | RejectedExecutionException error) {
                    if (!closed) close();
                }
            }
        }, "game-assets");
        accept.setDaemon(true); accept.start();
    }
    String url(String path) { return origin + prefix + path; }
    boolean isOrigin(String uri) {
        try {
            URI parsed=URI.create(uri);
            return "http".equals(parsed.getScheme()) && "127.0.0.1".equals(parsed.getHost()) &&
                parsed.getPort()==listener.getLocalPort() && parsed.getUserInfo()==null;
        } catch(Exception ignored) { return false; }
    }
    boolean isApp(String uri) {
        try {
            URI parsed = URI.create(uri);
            return isOrigin(uri) && parsed.getRawPath().startsWith(prefix);
        } catch (Exception ignored) { return false; }
    }
    void event(String name, boolean value) {
        String message = "data: {\"name\":\"" + name + "\",\"value\":" + value + "}\n\n";
        for (BlockingQueue<String> queue : events) queue.offer(message);
    }
    private void serve(Socket socket) {
        try (Socket ignored = socket) {
            socket.setSoTimeout(10000);
            InputStream input = new BufferedInputStream(socket.getInputStream());
            OutputStream output = new BufferedOutputStream(socket.getOutputStream());
            String request = line(input);
            String[] parts = request.split(" ");
            if (parts.length != 3) { respond(output, 400, "Bad Request"); return; }
            Map<String,String> headers = new HashMap<>();
            for (int count = 0; ; count++) {
                String header = line(input);
                if (header.isEmpty()) break;
                if (count >= 64) throw new IOException("Too many headers");
                int colon = header.indexOf(':');
                if (colon < 1) throw new IOException("Invalid header");
                String key = header.substring(0,colon).toLowerCase(Locale.ROOT);
                if (headers.put(key, header.substring(colon+1).trim()) != null) throw new IOException("Duplicate header");
            }
            if (!origin.substring(7).equals(headers.get("host"))) { respond(output,403,"Forbidden"); return; }
            URI uri = URI.create(parts[1]);
            String path = uri.getPath();
            if (uri.isAbsolute() || path == null || !path.startsWith(prefix) || path.contains("..") || path.contains("\\")) {
                respond(output,404,"Not Found"); return;
            }
            String asset = path.substring(prefix.length());
            if (asset.startsWith("__native/call/")) {
                if (!"POST".equals(parts[0]) || !token.equals(headers.get("x-projectgreed-token")) ||
                    (headers.containsKey("origin") && !origin.equals(headers.get("origin")))) {
                    respond(output,403,"Forbidden"); return;
                }
                if (headers.containsKey("transfer-encoding")) { respond(output,400,"Bad Request"); return; }
                long length = Long.parseLong(headers.getOrDefault("content-length","-1"));
                if (length < 0 || length > MAX_BODY) { respond(output,413,"Payload Too Large"); return; }
                byte[] body = new byte[(int)length];
                int offset = 0;
                while (offset < body.length) {
                    int size = input.read(body,offset,body.length-offset);
                    if (size < 0) throw new EOFException();
                    offset += size;
                }
                String response = calls.call(asset.substring("__native/call/".length()),new String(body,StandardCharsets.UTF_8));
                bytes(output, "application/json", response.getBytes(StandardCharsets.UTF_8));
                return;
            }
            if (!"GET".equals(parts[0])) { respond(output,405,"Method Not Allowed"); return; }
            if (asset.equals("__native/events")) {
                // A reload replaces the old event stream; do not occupy a worker until its heartbeat.
                for (BlockingQueue<String> old : events) old.offer("close");
                BlockingQueue<String> queue = new ArrayBlockingQueue<>(32);
                events.add(queue);
                try {
                    head(output, "text/event-stream", -1);
                    output.write(": ready\n\n".getBytes(StandardCharsets.UTF_8)); output.flush();
                    while (!closed) {
                        String message = queue.poll(20,TimeUnit.SECONDS);
                        if ("close".equals(message)) break;
                        output.write((message == null ? ": alive\n\n" : message).getBytes(StandardCharsets.UTF_8));
                        output.flush();
                    }
                } finally { events.remove(queue); }
                return;
            }
            if (asset.equals("__native/bridge.js")) asset = "gecko-bridge.js";
            if (asset.isEmpty()) asset = "compatibility.html";
            try (InputStream data = assets.open(asset)) {
                if (asset.endsWith(".html")) {
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream(); copy(data, buffer);
                    String html = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
                    if (asset.equals("compatibility.html")) html = html
                        .replace("default-src 'none';", "default-src 'none'; connect-src 'self';")
                        .replace("正在检查 WebView 兼容性", "正在检查内置 Gecko 内核兼容性");
                    html = html.replace("<head>", "<head><script src=\"" + prefix + "__native/bridge.js\" data-token=\"" + token + "\"></script>");
                    bytes(output,"text/html",html.getBytes(StandardCharsets.UTF_8));
                } else {
                    head(output,mime(asset),-1); copy(data,output); output.flush();
                }
            } catch (FileNotFoundException error) { respond(output,404,"Not Found"); }
        } catch (Exception ignored) {
            // Disconnected navigation/streams are normal. Native save failures are explicit JSON responses.
        } finally { sockets.remove(socket); }
    }
    private static String line(InputStream input) throws IOException {
        ByteArrayOutputStream line = new ByteArrayOutputStream();
        for (int count = 0; count < 16384; count++) {
            int c = input.read();
            if (c < 0) throw new EOFException();
            if (c == '\n') return new String(line.toByteArray(),StandardCharsets.US_ASCII).trim();
            line.write(c);
        }
        throw new IOException("Header too long");
    }
    private static void copy(InputStream input, OutputStream output) throws IOException {
        byte[] block = new byte[32768]; int n;
        while ((n=input.read(block))!=-1) output.write(block,0,n);
    }
    private static void respond(OutputStream output,int code,String text) throws IOException {
        output.write(("HTTP/1.1 "+code+" "+text+"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII)); output.flush();
    }
    private static void head(OutputStream output,String type,long length) throws IOException {
        String headers = "HTTP/1.1 200 OK\r\nContent-Type: "+type+"\r\nCache-Control: no-store\r\n" +
            "X-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n";
        if (length >= 0) headers += "Content-Length: "+length+"\r\n";
        output.write((headers+"\r\n").getBytes(StandardCharsets.US_ASCII));
    }
    private static void bytes(OutputStream output,String type,byte[] body) throws IOException {
        head(output,type,body.length); output.write(body); output.flush();
    }
    static String mime(String path) {
        String ext = path.substring(path.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        switch(ext) {
            case "html": return "text/html";
            case "js": return "application/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "svg": return "image/svg+xml";
            case "ogg": return "audio/ogg";
            case "mp3": return "audio/mpeg";
            case "wav": return "audio/wav";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            default: return "application/octet-stream";
        }
    }
    @Override public void close() {
        closed = true;
        try { listener.close(); } catch (IOException ignored) { }
        for (Socket socket : sockets) try { socket.close(); } catch (IOException ignored) { }
        workers.shutdownNow();
    }
}
