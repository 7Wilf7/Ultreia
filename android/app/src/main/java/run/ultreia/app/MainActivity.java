package run.ultreia.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the custom native plugins before the bridge initializes so JS
        // can call ApkInstaller.install({ path }), ApkDownloader.download(...),
        // and PosterSaver.savePng(...).
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ApkDownloaderPlugin.class);
        registerPlugin(PosterSaverPlugin.class);
        registerPlugin(UltreiaGetuiPlugin.class);
        registerPlugin(UltreiaKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
