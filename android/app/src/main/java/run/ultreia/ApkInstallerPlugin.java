package run.ultreia;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

// Minimal native bridge for in-app APK self-update. The JS side downloads the
// release APK with @capacitor/filesystem (to the app cache dir), then calls
// install({ path }) here to launch the system package installer on that file.
//
// We expose the file to the installer through the FileProvider already declared
// in AndroidManifest (authority "${applicationId}.fileprovider"); the cache dir
// is covered by the <cache-path> entry in res/xml/file_paths.xml. Requires the
// REQUEST_INSTALL_PACKAGES permission (also in the manifest); the OS still gates
// the actual install behind the user's "allow from this source" toggle.
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("missing path");
            return;
        }
        try {
            File apk = new File(path.replace("file://", ""));
            if (!apk.exists()) {
                call.reject("apk not found: " + apk.getAbsolutePath());
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "install failed" : e.getMessage());
        }
    }
}
