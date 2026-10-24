using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Security.AccessControl;
using System.Runtime.InteropServices;

public static class NativeHost {
  static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=900000,RecursionLimit=50};
  static readonly byte[] Entropy=Encoding.UTF8.GetBytes("IABTMasterControl/v1");
  static string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"IABTMasterControl","Vault");
  static bool Testing=false;
  [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
  [StructLayout(LayoutKind.Sequential)] struct INPUT {public uint type;public UNION data;}
  [StructLayout(LayoutKind.Explicit)] struct UNION {[FieldOffset(0)] public MOUSE mouse;[FieldOffset(0)] public KEY key;}
  [StructLayout(LayoutKind.Sequential)] struct MOUSE {public int x,y;public uint mouseData,flags,time;public IntPtr extra;}
  [StructLayout(LayoutKind.Sequential)] struct KEY {public ushort vk,scan;public uint flags,time;public IntPtr extra;}
  [DllImport("user32.dll",SetLastError=true)] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,INPUT[] inputs,int size);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int MessageBoxW(IntPtr owner,string message,string title,uint type);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window,StringBuilder text,int max);
  delegate bool EnumWindow(IntPtr window,IntPtr extra);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindow callback,IntPtr extra);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  static Dictionary<string,object> Map(object value){var result=value as Dictionary<string,object>;if(result==null)throw new Exception("Expected an object.");return result;}
  static string Str(Dictionary<string,object> map,string key,int max){object value;if(!map.TryGetValue(key,out value)||!(value is string)||((string)value).Length>max)throw new Exception("Invalid "+key+".");return (string)value;}
  static int Num(Dictionary<string,object> map,string key){object value;if(!map.TryGetValue(key,out value)||!(value is int))throw new Exception("Invalid coordinate or count.");return (int)value;}
  static object Ok(params object[] fields){var result=new Dictionary<string,object>{{"ok",true}};for(int i=0;i<fields.Length;i+=2)result[(string)fields[i]]=fields[i+1];return result;}
  static byte[] Seal(byte[] bytes){return ProtectedData.Protect(bytes,Entropy,DataProtectionScope.CurrentUser);}
  static byte[] Open(byte[] bytes){return ProtectedData.Unprotect(bytes,Entropy,DataProtectionScope.CurrentUser);}
  static void PrivateFolder(){
    if(!Directory.Exists(Root))throw new Exception("Install the companion before using the vault.");
    var current=WindowsIdentity.GetCurrent().User;var security=Directory.GetAccessControl(Root);
    foreach(FileSystemAccessRule rule in security.GetAccessRules(true,true,typeof(SecurityIdentifier)))
      if(rule.AccessControlType==AccessControlType.Allow&&rule.IdentityReference.Value!=current.Value&&rule.IdentityReference.Value!="S-1-5-18")throw new Exception("Vault permissions are too broad. Re-run the installer.");
  }
  static object ReadVault(string name){var file=Path.Combine(Root,name);if(!File.Exists(file))return null;return Json.DeserializeObject(Encoding.UTF8.GetString(Open(File.ReadAllBytes(file))));}
  static void WriteVault(string name,object value){
    var bytes=Encoding.UTF8.GetBytes(Json.Serialize(value));if(bytes.Length>800000)throw new Exception("Workspace is too large. Export and reduce saved captures.");
    var file=Path.Combine(Root,name);var temporary=file+"."+Guid.NewGuid().ToString("N")+".tmp";
    using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None)){var encrypted=Seal(bytes);stream.Write(encrypted,0,encrypted.Length);stream.Flush(true);}
    if(File.Exists(file))File.Replace(temporary,file,null);else File.Move(temporary,file);
  }
  static void History(object data){
    var record=new Dictionary<string,object>{{"timestamp",DateTime.UtcNow.ToString("o")},{"event",data}};
    var sealedRecord=Seal(Encoding.UTF8.GetBytes(Json.Serialize(record)));
    using(var file=new FileStream(Path.Combine(Root,"history.enc"),FileMode.Append,FileAccess.Write,FileShare.Read)){var length=BitConverter.GetBytes(sealedRecord.Length);file.Write(length,0,4);file.Write(sealedRecord,0,sealedRecord.Length);file.Flush(true);}
  }
  static string Title(IntPtr handle){var title=new StringBuilder(301);GetWindowTextW(handle,title,301);return title.ToString();}
  static void Confirm(string message){if(Testing)throw new Exception("Interactive actions disabled in self-test.");if(MessageBoxW(IntPtr.Zero,message+"\n\nApprove this one action? Select No to cancel.","IABT Master Control — Permission",0x00010000|0x00040000|0x00000100|0x00000004|0x00000030)!=6)throw new Exception("Permission denied. No action was performed.");}
  public static string ValidateAction(Dictionary<string,object> action){
    var kind=Str(action,"kind",20);if(!new[]{"move","click","doubleClick","rightClick","scroll","type","key"}.Contains(kind))throw new Exception("Unsupported action.");
    if(new[]{"move","click","doubleClick","rightClick","scroll"}.Contains(kind)){int x=Num(action,"x"),y=Num(action,"y");if(Math.Abs((long)x)>100000||Math.Abs((long)y)>100000)throw new Exception("Coordinate out of range.");}
    if(kind=="scroll"&&(Num(action,"amount")==0||Math.Abs((long)Num(action,"amount"))>20))throw new Exception("Scroll count out of range.");
    if(kind=="type"&&Str(action,"text",2000).Length==0)throw new Exception("Empty text.");
    if(kind=="key"&&!new[]{"ENTER","TAB","ESC","BACKSPACE","CTRL+A","CTRL+C","CTRL+V","CTRL+Z","CTRL+L"}.Contains(Str(action,"key",30)))throw new Exception("Unsupported shortcut.");
    if(kind=="key"||kind=="type"){long number;if(!Int64.TryParse(Str(action,"window",20),out number)||number<=0)throw new Exception("Select a target window.");Str(action,"title",300);}
    return kind;
  }
  static void Send(INPUT[] inputs){if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf(typeof(INPUT)))!=inputs.Length)throw new Exception("Windows did not accept all input. Do not automatically retry; inspect the target first.");}
  static INPUT Mouse(uint flag,uint data){return new INPUT{type=0,data=new UNION{mouse=new MOUSE{flags=flag,mouseData=data}}};}
  static INPUT Key(ushort vk,ushort scan,uint flag){return new INPUT{type=1,data=new UNION{key=new KEY{vk=vk,scan=scan,flags=flag}}};}
  static object Perform(Dictionary<string,object> request){
    var id=Str(request,"id",36);Guid parsed;if(!Guid.TryParse(id,out parsed))throw new Exception("Invalid operation ID.");
    var action=Map(request["action"]);var kind=ValidateAction(action);string receiptName="action-"+parsed.ToString("N")+".enc";
    var existing=ReadVault(receiptName);if(existing!=null)return Ok("reused",true,"receipt",existing,"message","This request was already admitted. Inspect the saved outcome before taking another action.");
    IntPtr target=IntPtr.Zero;string detail;
    if(kind=="type"||kind=="key"){
      target=new IntPtr(Int64.Parse((string)action["window"]));if(!IsWindow(target)||Title(target)!=(string)action["title"])throw new Exception("The target window changed. Refresh the window list.");
      detail=kind=="type"?"Type "+((string)action["text"]).Length+" characters into "+Title(target)+".\n\nText preview:\n"+((string)action["text"]).Substring(0,Math.Min(300,((string)action["text"]).Length)):"Press "+action["key"]+" in "+Title(target);
    }else{
      int x=Num(action,"x"),y=Num(action,"y"),left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
      if(x<left||y<top||x>=left+width||y>=top+height)throw new Exception("Point is outside the virtual desktop.");
      detail=kind+" at physical desktop coordinate ("+x+", "+y+").\n"+(kind=="scroll"?"Scroll notches: "+action["amount"]+"\n":"")+"Verify what is at this point before approving. This can affect other applications.";
    }
    var audit=new Dictionary<string,object>{{"kind",kind},{"id",id},{"status","requested"}};
    if(kind=="type")audit["characters"]=((string)action["text"]).Length;else foreach(var pair in action)audit[pair.Key]=pair.Value;
    History(audit);
    try{Confirm(detail);}catch{History(new{kind=kind,id=id,status="denied"});throw;}
    WriteVault(receiptName,new{status="pending",kind=kind,id=id});History(new{kind=kind,id=id,status="approved"});
    try{
      foreach(int modifier in new[]{16,17,18,91,92})if((GetAsyncKeyState(modifier)&0x8000)!=0)throw new Exception("Release held Shift, Ctrl, Alt and Windows keys before requesting another action. No input was attempted.");
      if(target!=IntPtr.Zero){if(!IsWindow(target)||Title(target)!=(string)action["title"]||!SetForegroundWindow(target)||GetForegroundWindow()!=target)throw new Exception("Target focus could not be verified. No typing was attempted.");}
      if(kind=="move"||kind=="click"||kind=="doubleClick"||kind=="rightClick"||kind=="scroll"){
        int x=Num(action,"x"),y=Num(action,"y");if(!SetCursorPos(x,y))throw new Exception("Cursor movement was refused.");POINT point;GetCursorPos(out point);if(point.X!=x||point.Y!=y)throw new Exception("Cursor position did not match.");
        if(kind=="click"||kind=="doubleClick")Send(new[]{Mouse(2,0),Mouse(4,0)});
        if(kind=="doubleClick")Send(new[]{Mouse(2,0),Mouse(4,0)});
        if(kind=="rightClick")Send(new[]{Mouse(8,0),Mouse(16,0)});
        if(kind=="scroll")Send(new[]{Mouse(0x800,unchecked((uint)(Num(action,"amount")*120)))});
      }else if(kind=="type"){
        var keys=new List<INPUT>();foreach(char c in (string)action["text"]){keys.Add(Key(0,c,4));keys.Add(Key(0,c,6));}Send(keys.ToArray());
      }else{
        string key=(string)action["key"];bool ctrl=key.StartsWith("CTRL+");ushort code=ctrl?(ushort)key[key.Length-1]:key=="ENTER"?(ushort)13:key=="TAB"?(ushort)9:key=="ESC"?(ushort)27:(ushort)8;
        var keys=new List<INPUT>();if(ctrl)keys.Add(Key(17,0,0));keys.Add(Key(code,0,0));keys.Add(Key(code,0,2));if(ctrl)keys.Add(Key(17,0,2));Send(keys.ToArray());
      }
      var receipt=new{status="dispatched",kind=kind,id=id};WriteVault(receiptName,receipt);History(receipt);return Ok("performed",true,"message","Input dispatched by Windows. Verify the application's result; dispatch is not task completion.");
    }catch(Exception error){WriteVault(receiptName,new{status="uncertain",kind=kind,id=id});History(new{status="uncertain",kind=kind,id=id});return new{ok=false,uncertain=true,error=error.Message+" Inspect the screen before retrying."};}
  }
  static object Dispatch(Dictionary<string,object> message){
    var type=Str(message,"type",50);
    if(type=="status")return Ok("version","0.1.0","folder",Root,"protection","Windows DPAPI CurrentUser + restricted folder ACL","platform","windows");
    if(type=="workspace.read")return Ok("workspace",ReadVault("workspace.enc"));
    if(type=="workspace.write"){
      var next=Map(message["workspace"]);int revision=Num(next,"revision");var prior=ReadVault("workspace.enc");if(prior!=null&&revision!=Num(Map(prior),"revision")+1)throw new Exception("Vault revision conflict. Reopen the panel.");if(prior==null&&revision<0)throw new Exception("Invalid revision.");
      History(new{type="workspace.save_requested",revision=revision,workspace=next});WriteVault("workspace.enc",next);History(new{type="workspace.saved",revision=revision});return Ok();
    }
    if(type=="history.append"){History(message["event"]);return Ok();}
    if(type=="history.search"){
      var query=Str(message,"query",100).ToLowerInvariant();var items=new List<object>();var file=Path.Combine(Root,"history.enc");
      if(File.Exists(file))using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite)){
        while(stream.Position<stream.Length){int size=BitConverter.ToInt32(ReadExact(stream,4),0);if(size<=0||size>1000000)throw new Exception("History record is damaged; original file preserved.");var decoded=Encoding.UTF8.GetString(Open(ReadExact(stream,size)));if(!decoded.ToLowerInvariant().Contains(query))continue;
          var record=Map(Json.DeserializeObject(decoded));var item=Map(record["event"]);var label=item.ContainsKey("type")?Convert.ToString(item["type"]):item.ContainsKey("kind")?Convert.ToString(item["kind"]):"activity";
          string summary=item.ContainsKey("command")?Convert.ToString(item["command"]):item.ContainsKey("status")?Convert.ToString(item["status"]):item.ContainsKey("workspace")?Convert.ToString(Map(item["workspace"])["goal"]):"Saved event";
          items.Insert(0,new{timestamp=record["timestamp"],type=label,summary=summary.Substring(0,Math.Min(summary.Length,300))});if(items.Count>50)items.RemoveAt(50);
        }
      }return Ok("items",items);
    }
    if(type=="cursor.read"){POINT point;if(!GetCursorPos(out point))throw new Exception("Cursor position is unavailable.");return Ok("x",point.X,"y",point.Y);}
    if(type=="windows.list"){
      Confirm("Share the titles and identifiers of visible application windows with the IABT Master Control extension.");var windows=new List<object>();
      EnumWindows((window,extra)=>{string title=Title(window);if(IsWindowVisible(window)&&title.Length>0&&windows.Count<100)windows.Add(new{id=window.ToInt64().ToString(),title=title});return true;},IntPtr.Zero);History(new{type="windows.list",status="approved"});return Ok("windows",windows);
    }
    if(type=="control.perform")return Perform(message);
    throw new Exception("Unknown companion operation.");
  }
  static byte[] ReadExact(Stream input,int count){var buffer=new byte[count];int offset=0;while(offset<count){int read=input.Read(buffer,offset,count-offset);if(read==0)throw new EndOfStreamException();offset+=read;}return buffer;}
  static void Output(object result){var bytes=Encoding.UTF8.GetBytes(Json.Serialize(result));var stream=Console.OpenStandardOutput();stream.Write(BitConverter.GetBytes(bytes.Length),0,4);stream.Write(bytes,0,bytes.Length);stream.Flush();}
  static int SelfTest(){
    Testing=true;string temporary=Path.Combine(Path.GetTempPath(),"iabt-native-test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(temporary);Root=temporary;
    try{
      byte[] source=Encoding.UTF8.GetBytes("private history fixture");var encrypted=Seal(source);if(Encoding.UTF8.GetString(Open(encrypted))!="private history fixture"||encrypted.SequenceEqual(source))throw new Exception("DPAPI round trip failed.");
      WriteVault("test.enc",new{goal="Local",revision=1});if((string)Map(ReadVault("test.enc"))["goal"]!="Local")throw new Exception("Vault persistence failed.");
      History(new{eventType="test"});if(File.ReadAllText(Path.Combine(Root,"history.enc")).Contains("eventType"))throw new Exception("History not encrypted.");
      ValidateAction(new Dictionary<string,object>{{"kind","click"},{"x",10},{"y",20}});
      bool rejected=false;try{ValidateAction(new Dictionary<string,object>{{"kind","shell"}});}catch{rejected=true;}if(!rejected)throw new Exception("Unknown action accepted.");
      rejected=false;try{Confirm("must fail in test");}catch{rejected=true;}if(!rejected)throw new Exception("Interactive test guard failed.");
      Console.WriteLine("PASS: DPAPI encryption, encrypted persistence/history, action allowlist and noninteractive guard. No cursor or keyboard actions were executed.");return 0;
    }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}finally{Directory.Delete(temporary,true);}
  }
  public static int Main(string[] args){
    if(args.Length==1&&args[0]=="--self-test")return SelfTest();
    try{
      SetProcessDPIAware();var install=Path.GetDirectoryName(typeof(NativeHost).Assembly.Location);var config=Map(Json.DeserializeObject(File.ReadAllText(Path.Combine(install,"host.json"))));
      var origins=(object[])config["allowed_origins"];if(args.Length<1||!origins.Any(origin=>(string)origin==args[0]))throw new Exception("Unregistered extension origin.");
      PrivateFolder();var input=Console.OpenStandardInput();int length=BitConverter.ToInt32(ReadExact(input,4),0);if(length<=0||length>900000)throw new Exception("Message size is invalid.");
      var message=Map(Json.DeserializeObject(Encoding.UTF8.GetString(ReadExact(input,length))));
      using(var gate=new FileStream(Path.Combine(Root,"vault.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)){Output(Dispatch(message));}
      return 0;
    }catch(Exception error){Output(new{ok=false,error=error.Message});return 1;}
  }
}
