package com.aitrainstudio.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;

@CapacitorPlugin(
    name = "PosterSaver",
    permissions = {
        @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public class PosterSaverPlugin extends Plugin {

    @PluginMethod
    public void savePng(PluginCall call) {
        if (Build.VERSION.SDK_INT <= 28 && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "savePngPermissionCallback");
            return;
        }
        String fileName = call.getString("fileName", "training-studio-poster.png");
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("missing data");
            return;
        }
        try {
            int comma = data.indexOf(',');
            String payload = comma >= 0 ? data.substring(comma + 1) : data;
            byte[] bytes = Base64.decode(payload, Base64.DEFAULT);

            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            if (Build.VERSION.SDK_INT >= 29) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Ultreia");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }

            Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                call.reject("create image failed");
                return;
            }
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) {
                    call.reject("open image failed");
                    return;
                }
                out.write(bytes);
            }
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, done, null, null);
            }

            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "save failed" : e.getMessage());
        }
    }

    @PermissionCallback
    private void savePngPermissionCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            savePng(call);
        } else {
            call.reject("storage permission denied");
        }
    }
}
