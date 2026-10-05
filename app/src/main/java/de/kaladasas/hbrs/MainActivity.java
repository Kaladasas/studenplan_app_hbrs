package de.kaladasas.hbrs;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public class MainActivity extends Activity {
    private LocalApiServer server;
    private WebView webView;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF4F7FB);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        webView.setWebViewClient(new WebViewClient());
        setContentView(webView);

        server = new LocalApiServer(getAssets(), getFilesDir());
        try {
            server.start();
            webView.loadUrl(server.getBaseUrl() + "/");
        } catch (Exception e) {
            Toast.makeText(this, "App konnte nicht gestartet werden: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override protected void onDestroy() {
        if (server != null) server.stop();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
