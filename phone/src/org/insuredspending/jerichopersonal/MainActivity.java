package org.insuredspending.jerichopersonal;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.*;
import android.widget.FrameLayout;
import android.view.WindowInsets;
import java.io.OutputStream;
import org.json.JSONObject;

/** Personal offline app. Optional explicit local-model network access; no account or JavaScript interface. */
public final class MainActivity extends Activity {
  private static final String HOME = "file:///android_asset/index.html";
  private WebView web;
  private ValueCallback<Uri[]> fileCallback;
  private byte[] pendingExport;
  private boolean choosingExport;
  private volatile boolean modelBusy;
  private volatile boolean destroyed;

  @Override public void onCreate(Bundle saved) {
    super.onCreate(saved);
    getWindow().setStatusBarColor(Color.rgb(16,18,28));
    getWindow().setNavigationBarColor(Color.rgb(16,18,28));
    FrameLayout root=new FrameLayout(this); root.setBackgroundColor(Color.rgb(16,18,28));
    root.setFitsSystemWindows(true);
    if(android.os.Build.VERSION.SDK_INT>=30) root.setOnApplyWindowInsetsListener((view,insets)->{
      android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
      view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;
    });
    web=new WebView(this); root.addView(web,new FrameLayout.LayoutParams(-1,-1)); setContentView(root);
    WebSettings settings=web.getSettings();
    settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(true); settings.setAllowContentAccess(true);
    settings.setAllowFileAccessFromFileURLs(false); settings.setAllowUniversalAccessFromFileURLs(false);
    settings.setBlockNetworkLoads(true); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setSupportMultipleWindows(false);settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setUserAgentString(settings.getUserAgentString()+" JerichoPersonal/1.1");
    WebView.setWebContentsDebuggingEnabled(false);
    web.setBackgroundColor(Color.rgb(16,18,28));
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
        String url=request.getUrl().toString();return !HOME.equals(url)&&!url.equals("about:blank");
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
        if(fileCallback!=null)fileCallback.onReceiveValue(null);fileCallback=callback;
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"text/html","text/plain","application/json"});
        try{startActivityForResult(intent,101);}catch(Exception error){fileCallback.onReceiveValue(null);fileCallback=null;}
        return true;
      }
      @Override public boolean onJsPrompt(WebView view,String url,String message,String value,JsPromptResult result){
        if(!HOME.equals(url)){result.cancel();return true;}
        if("JERICHO_LOCAL_AI".equals(message)){
          if(modelBusy||value==null||value.length()>100000){result.cancel();return true;}
          try {
            JSONObject request=new JSONObject(value);String id=request.getString("id"),action=request.getString("action");
            if(!id.matches("[A-Za-z0-9_-]{1,100}")||!(action.equals("models")||action.equals("generate"))||!request.optBoolean("consent",false))throw new IllegalArgumentException();
            LocalModelClient client=new LocalModelClient(request.getString("origin"));
            final String model=request.optString("model",""),instruction=request.optString("instruction",""),source=request.optString("source","");
            modelBusy=true;result.confirm("accepted");
            new Thread(()->{
              JSONObject response=new JSONObject();
              try {response.put("id",id).put("ok",true);if(action.equals("models"))response.put("models",client.models());else response.put("html",client.generate(model,instruction,source));}
              catch(Exception ignored){try{response=new JSONObject().put("id",id).put("ok",false).put("message","Local model did not return a complete app. Check the computer connection, installed model and available memory. No request was retried; existing projects are unchanged.");}catch(Exception impossible){}}
              final String payload=response.toString();modelBusy=false;
              runOnUiThread(()->{if(!destroyed&&web!=null)web.evaluateJavascript("window.jerichoLocalResult&&window.jerichoLocalResult("+payload+")",null);});
            }).start();
          }catch(Exception ignored){result.cancel();}
          return true;
        }
        if(!"JERICHO_SAVE".equals(message)){
          final android.widget.EditText input=new android.widget.EditText(MainActivity.this);input.setText(value);
          new AlertDialog.Builder(MainActivity.this).setTitle(message).setView(input).setPositiveButton("Save",(d,w)->result.confirm(input.getText().toString())).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
        }
        if(choosingExport||value==null||value.length()>12*1024*1024){result.cancel();return true;}
        try{
          JSONObject request=new JSONObject(value);String name=request.getString("name");String type=request.getString("type");
          if(!name.matches("[A-Za-z0-9_.-]{1,120}")||!(type.equals("text/html")||type.equals("text/plain")||type.equals("application/json")))throw new IllegalArgumentException();
          byte[] bytes=Base64.decode(request.getString("base64"),Base64.DEFAULT);if(bytes.length>8*1024*1024)throw new IllegalArgumentException();
          pendingExport=bytes;choosingExport=true;
          Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(type);intent.putExtra(Intent.EXTRA_TITLE,name);
          startActivityForResult(intent,102);result.confirm("accepted");
        }catch(Exception error){pendingExport=null;choosingExport=false;result.cancel();}
        return true;
      }
      @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){
        if(!HOME.equals(url)){result.cancel();return true;}
        new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;
      }
      @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result){
        if(!HOME.equals(url)){result.cancel();return true;}
        new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("Confirm",(d,w)->result.confirm()).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
      }
    });
    web.loadUrl(HOME);
  }
  @Override protected void onActivityResult(int request,int result,Intent data){
    super.onActivityResult(request,result,data);
    if(request==101&&fileCallback!=null){fileCallback.onReceiveValue(result==RESULT_OK&&data!=null&&data.getData()!=null?new Uri[]{data.getData()}:null);fileCallback=null;}
    if(request==102){
      final byte[] bytes=pendingExport;pendingExport=null;choosingExport=false;
      if(result!=RESULT_OK||data==null||data.getData()==null||bytes==null){reportExport(false);return;}
      final Uri destination=data.getData();
      new Thread(()->{boolean ok=false;try(OutputStream stream=getContentResolver().openOutputStream(destination,"wt")){if(stream!=null){stream.write(bytes);stream.flush();ok=true;}}catch(Exception ignored){}final boolean done=ok;runOnUiThread(()->reportExport(done));}).start();
    }
  }
  private void reportExport(boolean ok){if(web!=null)web.evaluateJavascript("window.jerichoExportResult&&window.jerichoExportResult("+ok+")",null);}
  @Override public void onBackPressed(){
    web.evaluateJavascript("typeof persisted!=='undefined'&&persisted",value->{String message=modelBusy?"A local model request is still running. Closing loses its unsaved result; the computer may continue working. Stay to receive it.":"true".equals(value)?"Close Jericho? Your projects are saved on this device.":"Your latest changes are NOT saved. Export a backup before closing, or they may be lost.";new AlertDialog.Builder(this).setMessage(message).setPositiveButton("Close",(d,w)->finish()).setNegativeButton("Stay",null).show();});
  }
  @Override protected void onDestroy(){destroyed=true;if(fileCallback!=null)fileCallback.onReceiveValue(null);if(web!=null){web.destroy();web=null;}super.onDestroy();}
}
