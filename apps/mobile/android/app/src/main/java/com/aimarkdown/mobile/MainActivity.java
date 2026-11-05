package com.aimarkdown.mobile;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import androidx.core.view.WindowCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Receives Android ACTION_SEND/ACTION_SEND_MULTIPLE payloads and hands them to the shared
 * renderer through window.__aimdReceiveShare. Files are copied into the app cache so the WebView
 * can upload them after the user confirms the favourite preview.
 */
public class MainActivity extends BridgeActivity {
    public static final String ACTION_OPEN_FAVORITE = "com.aimarkdown.mobile.action.OPEN_FAVORITE";
    public static final String EXTRA_OPEN_FAVORITE = "openFavorite";
    private static final String PENDING_KEY = "aimarkdown.pendingShare";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Immersive status + navigation bars: the renderer owns the insets through
        // env(safe-area-inset-*), so the WebView must reach the window edges. Android 15+
        // enforces edge-to-edge anyway; this keeps Android 14 and below identical.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        dispatchNativeAction(getIntent());
        dispatchShare(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        dispatchNativeAction(intent);
        dispatchShare(intent);
    }

    private void dispatchNativeAction(Intent intent) {
        if (intent == null) return;
        boolean openFavorite = intent.getBooleanExtra(EXTRA_OPEN_FAVORITE, false)
            || ACTION_OPEN_FAVORITE.equals(intent.getAction());
        if (!openFavorite) return;
        // A widget tap is a one-shot command; do not replay it after process recreation.
        intent.removeExtra(EXTRA_OPEN_FAVORITE);
        intent.setAction(null);
        String requestId = String.valueOf(System.currentTimeMillis());
        injectWithRetries("(() => {"
            + " if (!window.__aimdOpenFavorite || window.__aimdWidgetRequest === '" + requestId + "') return;"
            + " window.__aimdWidgetRequest = '" + requestId + "';"
            + " window.__aimdOpenFavorite();"
            + " })();");
    }

    private void dispatchShare(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("id", UUID.randomUUID().toString());
            payload.put("source", "android");
            java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            fmt.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            payload.put("receivedAt", fmt.format(new java.util.Date()));
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text != null) payload.put("text", text.toString());

            List<Uri> uris = new ArrayList<>();
            Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) uris.add(single);
            ArrayList<Uri> multiple = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (multiple != null) uris.addAll(multiple);

            JSONArray files = new JSONArray();
            for (Uri uri : uris) {
                JSONObject file = copyToCache(uri);
                if (file != null) files.put(file);
            }
            if (files.length() > 0) payload.put("files", files);
            if (!payload.has("text") && files.length() == 0) return;

            String json = payload.toString();
            getSharedPreferences("aimd_share", MODE_PRIVATE).edit().putString(PENDING_KEY, json).apply();
            injectWithRetries("window.__aimdReceiveShare && window.__aimdReceiveShare(" + json + ");");
        } catch (Exception ignored) {
            // A malformed share must never crash the notebook.
        }
    }

    private JSONObject copyToCache(Uri uri) {
        try {
            String mime = getContentResolver().getType(uri);
            if (mime == null) mime = "application/octet-stream";
            String name = queryName(uri);
            if (name == null || name.length() == 0) name = "shared-" + System.currentTimeMillis();
            File dir = new File(getCacheDir(), "share-inbox");
            if (!dir.exists()) dir.mkdirs();
            File target = new File(dir, UUID.randomUUID() + "-" + name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (InputStream input = getContentResolver().openInputStream(uri);
                 FileOutputStream output = new FileOutputStream(target)) {
                if (input == null) return null;
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
            }
            JSONObject file = new JSONObject();
            file.put("path", target.getAbsolutePath());
            file.put("name", name);
            file.put("mime", mime);
            return file;
        } catch (Exception ignored) {
            return null;
        }
    }

    private String queryName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {
            // Fall back to the path segment below.
        }
        return uri.getLastPathSegment();
    }

    private void injectWithRetries(String script) {
        long[] delays = new long[] {800L, 2500L, 6000L};
        android.os.Handler handler = new android.os.Handler(getMainLooper());
        for (long delay : delays) {
            handler.postDelayed(() -> {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null) webView.evaluateJavascript(script, null);
            }, delay);
        }
    }
}
