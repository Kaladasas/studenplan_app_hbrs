package de.kaladasas.hbrs;

import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.WeekFields;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LocalApiServer {
    private static final String BASE = "https://eva2.inf.h-brs.de/stundenplan/";
    private static final String SCHEDULE = "https://eva2.inf.h-brs.de/stundenplan/anzeigen/";
    private static final String TERM = "c32ef58d2e1df421b3b48ef959d32758";
    private static final String WEEKS = "1;2;3;4;5;6;7;8;9;10;11;12;13;14;15;16;17;18;19;20;21;22;23;24;25;26;27;28;29;30;31;32;33;34;35;36;37;38;39;40;41;42;43;44;45;46;47;48;49;50;51;52;53";
    private final AssetManager assets;
    private final File filesDir;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket socket;
    private volatile boolean running;
    private final Map<String, JSONObject> cache = new ConcurrentHashMap<>();

    public LocalApiServer(AssetManager assets, File filesDir) { this.assets = assets; this.filesDir = filesDir; }
    public String getBaseUrl() { return "http://127.0.0.1:" + (socket == null ? 8765 : socket.getLocalPort()); }

    public void start() throws IOException {
        socket = new ServerSocket(0, 20, InetAddress.getByName("127.0.0.1"));
        running = true;
        pool.execute(() -> { while (running) { try { Socket s = socket.accept(); pool.execute(() -> handle(s)); } catch (IOException ignored) {} } });
    }
    public void stop() { running = false; try { if (socket != null) socket.close(); } catch (IOException ignored) {} pool.shutdownNow(); }

    private void handle(Socket s) {
        try (Socket socket = s) {
            socket.setSoTimeout(45000);
            BufferedReader r = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String request = r.readLine(); if (request == null) return;
            String[] first = request.split(" ", 3); String method = first[0]; String target = first[1];
            int contentLength = 0; String line;
            while ((line = r.readLine()) != null && !line.isEmpty()) if (line.toLowerCase(Locale.ROOT).startsWith("content-length:")) contentLength = Integer.parseInt(line.substring(15).trim());
            char[] bodyChars = new char[contentLength]; int read = 0; while (read < contentLength) { int n = r.read(bodyChars, read, contentLength-read); if (n < 0) break; read += n; }
            byte[] body = new String(bodyChars).getBytes(StandardCharsets.UTF_8);
            Response resp = route(method, target, body);
            OutputStream out = socket.getOutputStream();
            String headers = "HTTP/1.1 " + resp.status + "\r\nContent-Type: " + resp.type + "\r\nContent-Length: " + resp.body.length + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
            out.write(headers.getBytes(StandardCharsets.UTF_8)); out.write(resp.body); out.flush();
        } catch (Exception ignored) {}
    }

    private Response route(String method, String target, byte[] body) throws Exception {
        URI uri = new URI("http://localhost" + target); String path = uri.getPath();
        if ("GET".equals(method) && "/".equals(path)) return asset("index.html", "text/html; charset=utf-8");
        if ("GET".equals(method) && path.startsWith("/static/")) return asset(path.substring(1), mime(path));
        if ("GET".equals(method) && "/api/semesters".equals(path)) return json(semesters());
        if ("GET".equals(method) && "/api/schedule".equals(path)) {
            String id = query(uri.getRawQuery(), "identifier_semester"); if (id == null || id.trim().isEmpty()) return error(400, "identifier_semester fehlt.");
            return json(schedule(id));
        }
        if ("GET".equals(method) && "/api/saved".equals(path)) return json(listSaved());
        if ("POST".equals(method) && "/api/saved".equals(path)) return json(savePlan(new String(body, StandardCharsets.UTF_8)));
        if ("GET".equals(method) && path.startsWith("/api/saved/")) return json(loadPlan(URLDecoder.decode(path.substring(11), "UTF-8")));
        return error(404, "Nicht gefunden");
    }

    private Response asset(String name, String type) throws IOException {
        try (InputStream in = assets.open(name)) { return new Response(200, type, readAll(in)); }
        catch (IOException e) { return error(404, "Asset nicht gefunden"); }
    }

    private JSONObject semesters() throws Exception {
        String html = httpGet(BASE, null);
        Matcher sm = Pattern.compile("<select\\b[^>]*>(.*?)</select>", Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(html);
        String chosen = null; String selectName = ""; String selectId = "";
        List<JSONObject> fallback = new ArrayList<>();
        while (sm.find()) {
            String select = sm.group(0), inner = sm.group(1), low = text(select).toLowerCase(Locale.ROOT);
            Matcher om = Pattern.compile("<option\\b([^>]*)>(.*?)</option>", Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(inner);
            List<JSONObject> opts = new ArrayList<>();
            while (om.find()) { String attrs=om.group(1), label=text(om.group(2)); String val=attr(attrs,"value"); if(val!=null&&!val.isEmpty()&&!label.isEmpty()&&!"0".equals(val)&&!"-1".equals(val)) { JSONObject o=new JSONObject(); o.put("label",label); o.put("identifier",val); opts.add(o); } }
            boolean candidate = low.contains("semester") || low.contains("studiengang") || low.contains("study") || inner.toLowerCase(Locale.ROOT).contains("bcsp");
            if (candidate && chosen == null) { chosen = select; fallback = opts; selectName=attr(attrsOfSelect(select),"name"); selectId=attr(attrsOfSelect(select),"id"); }
        }
        if (chosen == null) return new JSONObject().put("error", "Studiengang/Semester-Auswahl wurde auf eva2 nicht gefunden.");
        JSONArray arr = new JSONArray(); for(JSONObject o:fallback) { String l=o.optString("label").toLowerCase(Locale.ROOT); if(l.contains("bcsp")||l.contains("bi ")||l.contains("bwi")||l.contains("mas")||l.contains("mcsp")||l.contains("mgt")||l.contains("mi ")||l.contains("mksn")||l.contains("mvg")) arr.put(o); }
        if(arr.length()==0) for(JSONObject o:fallback) arr.put(o);
        return new JSONObject().put("items",arr).put("select_name",selectName).put("select_id",selectId);
    }

    private JSONObject schedule(String identifier) throws Exception {
        JSONObject c=cache.get(identifier); if(c!=null) return c;
        String savedKey="cache_"+Integer.toHexString(identifier.hashCode())+".json"; File f=new File(filesDir,savedKey);
        if(f.exists()) try { JSONObject old=new JSONObject(new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8)); cache.put(identifier,old); return old; } catch(Exception ignored) {}
        Map<String,String> p=new LinkedHashMap<>(); p.put("weeks",WEEKS); p.put("days","1-7"); p.put("mode","table"); p.put("identifier_semester",identifier); p.put("show_semester",""); p.put("identifier_dozent",""); p.put("identifier_raum",""); p.put("term",TERM);
        String html=httpGet(SCHEDULE,p); JSONArray events=parseSchedule(html); JSONArray weeks=new JSONArray(); TreeSet<Integer> set=new TreeSet<>(); for(int i=0;i<events.length();i++){int w=events.getJSONObject(i).optInt("week",-1); if(w>0)set.add(w);} for(int w:set)weeks.put(w);
        JSONObject result=new JSONObject().put("events",events).put("all_events",events).put("identifier_semester",identifier).put("available_weeks",weeks).put("plan_weeks",range53).put("cached",true);
        cache.put(identifier,result); try(FilesWriter fw=new FilesWriter(f)){fw.write(result.toString());} catch(Exception ignored){} return result;
    }
    private final JSONArray range53 = makeRange53();
    private static JSONArray makeRange53(){JSONArray a=new JSONArray();for(int i=1;i<=53;i++)a.put(i);return a;}

    private JSONArray parseSchedule(String html) {
        JSONArray out=new JSONArray(); Set<String> seen=new HashSet<>();
        Matcher tm=Pattern.compile("<table\\b[^>]*>(.*?)</table>",Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(html);
        boolean any=false; while(tm.find()){String table=tm.group(1); String low=text(table).toLowerCase(Locale.ROOT); Matcher hm=Pattern.compile("<th\\b[^>]*>(.*?)</th>",Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(table); StringBuilder heads=new StringBuilder();while(hm.find())heads.append(text(hm.group(1)).toLowerCase(Locale.ROOT)).append(' '); if(heads.toString().contains("activity")||heads.toString().contains("from")||heads.toString().contains("until")||(low.contains("activity")&&low.contains("from")&&low.contains("until"))) { parseTable(table,out,seen); any=true; }}
        if(!any){tm=Pattern.compile("<table\\b[^>]*>(.*?)</table>",Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(html);while(tm.find())parseTable(tm.group(1),out,seen);} return out;
    }
    private void parseTable(String table, JSONArray out, Set<String> seen){
        Map<String,String> dayMap=new HashMap<>(); String[][] ds={{"mo","Montag"},{"monday","Montag"},{"montag","Montag"},{"tu","Dienstag"},{"tue","Dienstag"},{"tues","Dienstag"},{"di","Dienstag"},{"dienstag","Dienstag"},{"we","Mittwoch"},{"wed","Mittwoch"},{"mi","Mittwoch"},{"mittwoch","Mittwoch"},{"th","Donnerstag"},{"thu","Donnerstag"},{"do","Donnerstag"},{"donnerstag","Donnerstag"},{"fr","Freitag"},{"fri","Freitag"},{"friday","Freitag"},{"freitag","Freitag"},{"sa","Samstag"},{"sat","Samstag"},{"samstag","Samstag"},{"su","Sonntag"},{"sun","Sonntag"},{"so","Sonntag"},{"sonntag","Sonntag"}};for(String[]x:ds)dayMap.put(x[0],x[1]);
        String current=null; Matcher rm=Pattern.compile("<tr\\b[^>]*>(.*?)</tr>",Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(table); while(rm.find()){List<String> cells=new ArrayList<>();Matcher cm=Pattern.compile("<(?:td|th)\\b[^>]*>(.*?)</(?:td|th)>",Pattern.CASE_INSENSITIVE|Pattern.DOTALL).matcher(rm.group(1));while(cm.find())cells.add(text(cm.group(1)));if(cells.isEmpty())continue;String first=cells.get(0).toLowerCase(Locale.ROOT).trim();String d=null;for(Map.Entry<String,String> e:dayMap.entrySet())if(first.equals(e.getKey())||first.startsWith(e.getKey()+",")||first.startsWith(e.getKey()+" ")){d=e.getValue();break;}if(d!=null){current=d;cells.remove(0);if(cells.isEmpty())continue;}if(current!=null&&cells.size()>=4){String start=time(cells.get(0)),end=time(cells.get(1));if(start==null||end==null)continue;JSONObject ev=new JSONObject();try{ev.put("day",current).put("start",start).put("end",end).put("room",cells.size()>2?cells.get(2):"").put("activity",cells.size()>3?cells.get(3):"").put("period",cells.size()>4?cells.get(4):"").put("lecturer",cells.size()>5?cells.get(5):""); expand(ev,out,seen);}catch(Exception ignored){}}}}
    }
    private void expand(JSONObject e,JSONArray out,Set<String> seen){String p=e.optString("period","");Matcher m=Pattern.compile("(\\d{1,2}\\.\\d{1,2}\\.\\d{4})\\s*-\\s*(\\d{1,2}\\.\\d{1,2}\\.\\d{4})").matcher(p);if(!m.find()){addUnique(e,out,seen);return;}LocalDate a,b;try{DateTimeFormatter f=DateTimeFormatter.ofPattern("d.M.uuuu");a=LocalDate.parse(m.group(1),f);b=LocalDate.parse(m.group(2),f);}catch(Exception x){addUnique(e,out,seen);return;}String mode=p.matches("(?s).*\\bgKW\\b.*")?"even":p.matches("(?s).*\\buKW\\b.*")?"odd":"all";DayOfWeek dow=day(e.optString("day"));for(LocalDate d=a;!d.isAfter(b);d=d.plusDays(1)){if(d.getDayOfWeek()!=dow)continue;int w=d.get(WeekFields.ISO.weekOfWeekBasedYear());if("even".equals(mode)&&w%2!=0)continue;if("odd".equals(mode)&&w%2!=1)continue;try{JSONObject x=new JSONObject(e.toString()).put("week",w).put("date",d.toString());addUnique(x,out,seen);}catch(Exception ignored){}}}
    private static void addUnique(JSONObject e,JSONArray out,Set<String> seen){String k=e.optString("week")+"|"+e.optString("date")+"|"+e.optString("day")+"|"+e.optString("start")+"|"+e.optString("end")+"|"+e.optString("room")+"|"+e.optString("activity")+"|"+e.optString("period")+"|"+e.optString("lecturer");if(seen.add(k))out.put(e);}
    private static DayOfWeek day(String s){switch(s){case "Montag":return DayOfWeek.MONDAY;case "Dienstag":return DayOfWeek.TUESDAY;case "Mittwoch":return DayOfWeek.WEDNESDAY;case "Donnerstag":return DayOfWeek.THURSDAY;case "Freitag":return DayOfWeek.FRIDAY;case "Samstag":return DayOfWeek.SATURDAY;default:return DayOfWeek.SUNDAY;}}
    private static String time(String v){v=clean(v).replace('.',':');Matcher m=Pattern.compile("(\\d{1,2}):(\\d{2})").matcher(v);if(!m.matches())return null;int h=Integer.parseInt(m.group(1)),mi=Integer.parseInt(m.group(2));return h>23||mi>59?null:String.format(Locale.ROOT,"%02d:%02d",h,mi);}

    private JSONObject listSaved() throws Exception {JSONArray a=new JSONArray();File d=new File(filesDir,"saved");if(!d.exists())d.mkdirs();File[] fs=d.listFiles((dir,name)->name.endsWith(".json"));if(fs!=null){Arrays.sort(fs,Comparator.comparing(f->f.getName().toLowerCase(Locale.ROOT)));for(File f:fs)a.put(new JSONObject().put("name",f.getName().substring(0,f.getName().length()-5)).put("filename",f.getName()));}return new JSONObject().put("items",a);}
    private JSONObject savePlan(String body)throws Exception{JSONObject data=new JSONObject(body);String name=sanitize(data.optString("name"));if(name==null)return new JSONObject().put("error","Bitte einen gültigen Namen angeben.");JSONObject save=new JSONObject().put("version",1).put("name",name).put("current_semester",data.optString("current_semester","")).put("semesters",data.optJSONArray("semesters")==null?new JSONArray():data.optJSONArray("semesters"));File d=new File(filesDir,"saved");d.mkdirs();File f=new File(d,name+".json");try(FilesWriter w=new FilesWriter(f)){w.write(save.toString());}return new JSONObject().put("success",true).put("name",name).put("filename",f.getName());}
    private JSONObject loadPlan(String name)throws Exception{String safe=sanitize(name);if(safe==null)return new JSONObject().put("error","Gespeicherter Stundenplan nicht gefunden.");File f=new File(new File(filesDir,"saved"),safe+".json");if(!f.exists())return new JSONObject().put("error","Gespeicherter Stundenplan nicht gefunden.");return new JSONObject(new String(Files.readAllBytes(f.toPath()),StandardCharsets.UTF_8));}
    private static String sanitize(String s){if(s==null)return null;s=s.trim().replaceAll("[<>:\"/\\\\|?*\\x00-\\x1F]","_").replaceAll("\\s+"," ").trim();if(s.toLowerCase(Locale.ROOT).endsWith(".json"))s=s.substring(0,s.length()-5);return s.isEmpty()?null:s;}

    private static String httpGet(String url,Map<String,String> params)throws Exception{if(params!=null&&!params.isEmpty()){StringBuilder q=new StringBuilder();for(Map.Entry<String,String>e:params.entrySet()){if(q.length()>0)q.append('&');q.append(URLEncoder.encode(e.getKey(),"UTF-8")).append('=').append(URLEncoder.encode(e.getValue(),"UTF-8"));}url+=(url.contains("?")?"&":"?")+q;}HttpsURLConnection c=(HttpsURLConnection)new URL(url).openConnection();c.setRequestMethod("GET");c.setConnectTimeout(20000);c.setReadTimeout(40000);c.setRequestProperty("User-Agent","H-BRS-Stundenplan-Android/1.0");int code=c.getResponseCode();InputStream in=code>=400?c.getErrorStream():c.getInputStream();String s=new String(readAll(in),StandardCharsets.UTF_8);if(code>=400)throw new IOException("Eva2 HTTP "+code);return s;}
    private static String query(String raw,String key)throws Exception{if(raw==null)return null;for(String p:raw.split("&")){String[]x=p.split("=",2);if(x.length==2&&URLDecoder.decode(x[0],"UTF-8").equals(key))return URLDecoder.decode(x[1],"UTF-8");}return null;}
    private static String attrsOfSelect(String tag){Matcher m=Pattern.compile("<select\\b([^>]*)>",Pattern.CASE_INSENSITIVE).matcher(tag);return m.find()?m.group(1):"";}
    private static String attr(String attrs,String name){Matcher m=Pattern.compile(name+"\\s*=\\s*[\\\"']([^\\\"']*)[\\\"']",Pattern.CASE_INSENSITIVE).matcher(attrs);return m.find()?m.group(1):null;}
    private static String text(String html){String s=html.replaceAll("(?is)<script.*?</script>|<style.*?</style>","").replaceAll("(?s)<[^>]+>"," ");s=s.replace("&nbsp;"," ").replace("&amp;","&").replace("&lt;","<").replace("&gt;",">").replace("&quot;","\"").replace("&#39;","'");Matcher nm=Pattern.compile("&#(\\d+);").matcher(s); StringBuffer sb=new StringBuffer(); while(nm.find()){String repl=nm.group(); try{repl=String.valueOf((char)Integer.parseInt(nm.group(1)));}catch(Exception ignored){} nm.appendReplacement(sb,Matcher.quoteReplacement(repl));} nm.appendTail(sb); return clean(sb.toString());}
    private static String clean(String s){return s==null?"":s.replaceAll("\\s+"," ").trim();}
    private static byte[] readAll(InputStream in)throws IOException{if(in==null)return new byte[0];ByteArrayOutputStream b=new ByteArrayOutputStream();byte[]buf=new byte[8192];int n;while((n=in.read(buf))!=-1)b.write(buf,0,n);return b.toByteArray();}
    private static String mime(String p){String x=p.toLowerCase(Locale.ROOT);if(x.endsWith(".html"))return"text/html; charset=utf-8";if(x.endsWith(".js"))return"application/javascript; charset=utf-8";if(x.endsWith(".css"))return"text/css; charset=utf-8";return"application/octet-stream";}
    private static Response json(JSONObject o){return new Response(200,"application/json; charset=utf-8",o.toString().getBytes(StandardCharsets.UTF_8));}
    private static Response error(int status,String msg){try{return new Response(status,"application/json; charset=utf-8",new JSONObject().put("error",msg).toString().getBytes(StandardCharsets.UTF_8));}catch(Exception e){return new Response(status,"application/json; charset=utf-8",("{\"error\":\""+msg.replace("\"","\\\"")+"\"}").getBytes(StandardCharsets.UTF_8));}}
    private static class Response{final int status;final String type;final byte[]body;Response(int s,String t,byte[]b){status=s;type=t;body=b;}}
    private static class FilesWriter implements Closeable { private final Writer w; FilesWriter(File f)throws IOException{w=Files.newBufferedWriter(f.toPath(),StandardCharsets.UTF_8);} void write(String s)throws IOException{w.write(s);} public void close()throws IOException{w.close();} }
}
