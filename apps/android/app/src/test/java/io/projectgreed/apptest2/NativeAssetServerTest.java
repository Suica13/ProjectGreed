package io.projectgreed.apptest2;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;

public final class NativeAssetServerTest {
    private NativeAssetServer server() throws Exception {
        return new NativeAssetServer(name -> {
            if(name.equals("client.html")) return new ByteArrayInputStream("<html><head></head><body>game</body></html>".getBytes(StandardCharsets.UTF_8));
            if(name.equals("compatibility.html")) return new ByteArrayInputStream("<head><meta content=\"default-src 'none';\"></head>".getBytes(StandardCharsets.UTF_8));
            if(name.equals("scripts/test.js")) return new ByteArrayInputStream("window.ready=true".getBytes(StandardCharsets.UTF_8));
            throw new FileNotFoundException(name);
        },(method,args)->"{\"ok\":true,\"method\":\""+method+"\"}");
    }
    private HttpURLConnection request(NativeAssetServer server,String path,String token,String origin) throws Exception {
        HttpURLConnection connection=(HttpURLConnection)new URL(server.url(path)).openConnection();
        connection.setConnectTimeout(2000); connection.setReadTimeout(2000);
        if(token!=null){
            connection.setRequestMethod("POST"); connection.setDoOutput(true);
            connection.setRequestProperty("X-ProjectGreed-Token",token);
            if(origin!=null)connection.setRequestProperty("Origin",origin);
            connection.getOutputStream().write("[]".getBytes(StandardCharsets.UTF_8));
        }
        return connection;
    }
    private String body(HttpURLConnection connection) throws Exception {
        try(InputStream input=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
            byte[] block=new byte[4096];int n;while((n=input.read(block))!=-1)bytes.write(block,0,n);
            return new String(bytes.toByteArray(),StandardCharsets.UTF_8);
        }finally{connection.disconnect();}
    }
    @Test public void bundledHtmlInjectsBridgeBeforeGameAndFilesHaveRealMimeTypes() throws Exception {
        try(NativeAssetServer server=server()){
            String html=body(request(server,"client.html",null,null));
            assertTrue(html.contains("__native/bridge.js")); assertTrue(html.indexOf("bridge.js")<html.indexOf("game"));
            HttpURLConnection script=request(server,"scripts/test.js",null,null);
            assertEquals("application/javascript",script.getContentType()); assertTrue(body(script).contains("ready=true"));
            assertTrue(body(request(server,"compatibility.html",null,null)).contains("connect-src 'self'"));
        }
    }
    @Test public void onlySecretLocalOriginCanCallNativeAndNavigationCannotEscape() throws Exception {
        try(NativeAssetServer server=server()){
            String token=new URI(server.url("client.html")).getPath().split("/")[1];
            assertTrue(body(request(server,"__native/call/read",token,null)).contains("\"ok\":true"));
            assertEquals(403,request(server,"__native/call/read","wrong",null).getResponseCode());
            assertEquals(403,request(server,"__native/call/read",null,null).getResponseCode());
            assertEquals(404,request(server,"../profile.json",null,null).getResponseCode());
            assertTrue(server.isApp(server.url("client.html")));
            assertFalse(server.isApp("https://example.com/client.html"));
            assertFalse(server.isApp(server.url("client.html").replace("127.0.0.1","localhost")));
            assertFalse(server.isApp(server.url("client.html").replace(token,"wrong")));
            URI target=new URI(server.url("__native/call/read"));
            try(Socket socket=new Socket("127.0.0.1",target.getPort())){
                socket.setSoTimeout(2000);
                String raw="POST "+target.getRawPath()+" HTTP/1.1\r\nHost: 127.0.0.1:"+target.getPort()+
                    "\r\nOrigin: https://foreign.example\r\nX-ProjectGreed-Token: "+token+"\r\nContent-Length: 2\r\n\r\n[]";
                socket.getOutputStream().write(raw.getBytes(StandardCharsets.US_ASCII));
                assertTrue(new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII)).readLine().contains("403"));
            }
        }
    }
    @Test public void lifecycleEventsUseOnePushStreamAndReloadReplacesTheOldConnection() throws Exception {
        try(NativeAssetServer server=server()){
            HttpURLConnection connection=request(server,"__native/events",null,null);
            BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),StandardCharsets.UTF_8));
            assertEquals(": ready",reader.readLine()); reader.readLine();
            server.event("freeze",true);
            assertEquals("data: {\"name\":\"freeze\",\"value\":true}",reader.readLine()); reader.readLine();
            HttpURLConnection next=request(server,"__native/events",null,null);
            BufferedReader second=new BufferedReader(new InputStreamReader(next.getInputStream(),StandardCharsets.UTF_8));
            assertEquals(": ready",second.readLine());
            assertNull(reader.readLine());
            connection.disconnect(); next.disconnect();
        }
    }
}
