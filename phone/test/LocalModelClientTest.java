import org.insuredspending.jerichopersonal.LocalModelClient;
import com.sun.net.httpserver.HttpServer;
import org.json.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
public final class LocalModelClientTest {
  static String mode="ok"; static AtomicInteger posts=new AtomicInteger();static String html="<!doctype html><html><head><title>Test</title></head><body><button>Test</button></body></html>";
  static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
  static void reject(Throwing action)throws Exception{try{action.run();throw new AssertionError("Expected refusal");}catch(java.io.IOException expected){}}
  interface Throwing{void run()throws Exception;}
  public static void main(String[] args)throws Exception{
    for(String endpoint:new String[]{"https://192.168.1.2:11434","http://8.8.8.8:11434","http://localhost:11434","http://192.168.1.2:11434/api","http://a@192.168.1.2:11434","http://169.254.169.254:11434","http://10.0.0.1:80","http://192.168.1.1:11434?key=x","http://[::1]:11434","http://127.1:11434"})reject(()->LocalModelClient.validateOrigin(endpoint));
    check(LocalModelClient.validateOrigin("http://192.168.1.4").equals("http://192.168.1.4:11434"),"private origin normalization");
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/api/tags",exchange->{String body;if(mode.equals("redirect")){exchange.getResponseHeaders().set("Location","http://8.8.8.8");exchange.sendResponseHeaders(302,-1);exchange.close();return;}JSONArray models=new JSONArray();models.put(new JSONObject().put("name",mode.equals("cloud")?"coder:cloud":"coder:local").put("digest",new String(new char[64]).replace('\0','a')).put("size",100).put("details",new JSONObject().put("format","gguf")));models.put(new JSONObject().put("name","pretend-local").put("digest",new String(new char[64]).replace('\0','a')).put("size",100).put("remote_host","https://provider.example").put("details",new JSONObject().put("format","gguf")));body=new JSONObject().put("models",models).toString();byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});
    server.createContext("/api/generate",exchange->{posts.incrementAndGet();JSONObject request=new JSONObject(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));check(request.getBoolean("stream")==false,"no stream assumption");check(request.getString("prompt").contains("<source>"),"source envelope present");if(posts.get()==1)check(request.getString("prompt").contains("Original source"),"source bound into request");check(request.getJSONObject("format").getString("type").equals("object"),"structured output");String response=new JSONObject().put("done",true).put("done_reason",mode.equals("truncated")?"length":"stop").put("response",new JSONObject().put("html",html).toString()).toString();byte[] bytes=response.getBytes(StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});
    server.start();try{
      LocalModelClient client=new LocalModelClient("http://127.0.0.1:"+server.getAddress().getPort());
      check(client.models().length()==1,"remote model omitted");check(client.generate("coder:local","Build useful app","Original source").equals(html),"returned source");check(posts.get()==1,"one generation POST");
      mode="cloud";reject(()->client.generate("coder:cloud","Build","Original source"));check(posts.get()==1,"cloud model cannot POST");
      mode="redirect";reject(()->client.models());check(posts.get()==1,"redirect not followed");
      mode="ok";reject(()->client.generate("coder:local","Change it",html));check(posts.get()==2,"unchanged revision refused");
      mode="truncated";reject(()->client.generate("coder:local","Build","Original source"));check(posts.get()==3,"truncation not retried");
      reject(()->client.generate("coder:local","","Original source"));check(posts.get()==3,"empty input cannot POST");
      System.out.println("Local model HTTP tests passed: private origins, local-only models, source binding, single POST, redirects and truncation.");
    }finally{server.stop(0);}
  }
}
