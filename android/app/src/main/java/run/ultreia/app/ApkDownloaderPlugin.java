package run.ultreia.app;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

// Background-safe APK download via Android's system DownloadManager. Unlike an
// in-app HTTP fetch (which the OS suspends when the app is backgrounded /
// screen off), DownloadManager runs as a system service: it keeps downloading
// in the background and shows progress in the notification tray. The JS side
// polls getProgress() for an in-app bar and calls ApkInstaller.install({ path })
// on the returned file when download() resolves.
@CapacitorPlugin(name = "ApkDownloader")
public class ApkDownloaderPlugin extends Plugin {

    private Long currentId = null;
    private File currentDest = null;
    private BroadcastReceiver receiver = null;
    private PluginCall pendingCall = null;

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String fileName = call.getString("fileName", "ts-update.apk");
        if (url == null || url.isEmpty()) { call.reject("missing url"); return; }

        final Context ctx = getContext();
        final DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) { call.reject("DownloadManager unavailable"); return; }

        // App-specific external dir — no storage permission needed, and shared to
        // the installer via the FileProvider <external-files-path> entry.
        final File dest = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
        if (dest.exists()) { try { dest.delete(); } catch (Exception ignored) {} }

        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
        req.setTitle("Ultreia");
        req.setDescription("Downloading update…");
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, fileName);
        req.setMimeType("application/vnd.android.package-archive");
        req.setAllowedOverMetered(true);
        req.setAllowedOverRoaming(true);

        final long id;
        try {
            id = dm.enqueue(req);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "enqueue failed" : e.getMessage());
            return;
        }
        currentId = id;
        currentDest = dest;
        pendingCall = call;

        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (completedId != id) return;
                try { c.unregisterReceiver(this); } catch (Exception ignored) {}
                receiver = null;

                int status = -1, reason = -1;
                Cursor cur = dm.query(new DownloadManager.Query().setFilterById(id));
                if (cur != null) {
                    if (cur.moveToFirst()) {
                        status = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        if (status != DownloadManager.STATUS_SUCCESSFUL) {
                            reason = cur.getInt(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                        }
                    }
                    cur.close();
                }
                PluginCall pc = pendingCall;
                pendingCall = null;
                if (pc == null) return;
                if (status == DownloadManager.STATUS_SUCCESSFUL && dest.exists()) {
                    JSObject ret = new JSObject();
                    ret.put("path", dest.getAbsolutePath());
                    pc.resolve(ret);
                } else {
                    pc.reject("download failed (status=" + status + ", reason=" + reason + ")");
                }
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        // ACTION_DOWNLOAD_COMPLETE is a system broadcast → must be exported on API 33+.
        if (Build.VERSION.SDK_INT >= 33) {
            ctx.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            ctx.registerReceiver(receiver, filter);
        }
    }

    // Polled by JS for the in-app progress bar. Returns bytes downloaded so far
    // and the total (total = -1 until the server reports Content-Length).
    @PluginMethod
    public void getProgress(PluginCall call) {
        JSObject ret = new JSObject();
        if (currentId == null) { ret.put("bytes", 0); ret.put("total", -1); call.resolve(ret); return; }
        DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        long bytes = 0, total = -1;
        if (dm != null) {
            Cursor cur = dm.query(new DownloadManager.Query().setFilterById(currentId));
            if (cur != null) {
                if (cur.moveToFirst()) {
                    bytes = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    total = cur.getLong(cur.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                }
                cur.close();
            }
        }
        ret.put("bytes", bytes);
        ret.put("total", total);
        call.resolve(ret);
    }
}
