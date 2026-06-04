package com.aitrainstudio.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the custom native plugins before the bridge initializes so JS
        // can call ApkInstaller.install({ path }) and ApkDownloader.download(...).
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(ApkDownloaderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
