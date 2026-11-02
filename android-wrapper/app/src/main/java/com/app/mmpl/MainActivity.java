package com.app.mmpl;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** Thin WebView shell around the Mohan Mishra PWA (URL set at build time via -PappUrl). */
public class MainActivity extends Activity {
    private static final int FILE_REQ = 41;
    private WebView web;
    private ProgressBar bar;
    private View offline;
    private ValueCallback<Uri[]> fileCb;
    private Uri home;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        home = Uri.parse(BuildConfig.APP_URL);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(bar, new FrameLayout.LayoutParams(-1, 8, Gravity.TOP));
        offline = buildOffline();
        offline.setVisibility(View.GONE);
        root.addView(offline, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // App-like: no pinch/double-tap zoom, fixed text scale, no overscroll glow/bounce (page handles its own scrolling)
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(Color.parseColor("#F8FAFC"));
        getWindow().setStatusBarColor(Color.parseColor("#123B65"));
        getWindow().setNavigationBarColor(Color.parseColor("#123B65"));
        s.setUserAgentString(s.getUserAgentString() + " MohanMishraApp/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return route(r.getUrl()); }
            @Override public void onPageFinished(WebView v, String url) { bar.setVisibility(View.GONE); }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) offline.setVisibility(View.VISIBLE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView v, int p) { bar.setProgress(p); bar.setVisibility(p < 100 ? View.VISIBLE : View.GONE); }
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try { startActivityForResult(p.createIntent(), FILE_REQ); } catch (ActivityNotFoundException e) { fileCb = null; return false; }
                return true;
            }
        });

        Uri deep = getIntent() != null ? getIntent().getData() : null;
        if (state != null) web.restoreState(state);
        else web.loadUrl(deep != null && isOwn(deep) ? deep.toString() : home.toString());
    }

    private boolean isOwn(Uri u) { if (u.getHost() == null) return false; String h = u.getHost().toLowerCase(), m = home.getHost().toLowerCase().replaceFirst("^www\\.", ""); return h.equals(m) || h.equals("www." + m); }

    /** Own site stays in the WebView; tel:, mailto:, upi:, WhatsApp, maps and other sites open externally. */
    private boolean route(Uri u) {
        String sc = u.getScheme() == null ? "" : u.getScheme();
        if ((sc.equals("http") || sc.equals("https")) && isOwn(u)) return false;
        try {
            Intent i = sc.equals("intent") ? Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME) : new Intent(Intent.ACTION_VIEW, u);
            startActivity(i);
        } catch (Exception ignored) { }
        return true;
    }

    private View buildOffline() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setPadding(48, 48, 48, 48);
        l.setBackgroundColor(Color.parseColor("#F8FAFC"));
        TextView t = new TextView(this); t.setText(R.string.offline_title); t.setTextSize(22); t.setTextColor(Color.parseColor("#123B65")); t.setGravity(Gravity.CENTER);
        TextView b = new TextView(this); b.setText(R.string.offline_body); b.setTextSize(15); b.setGravity(Gravity.CENTER); b.setPadding(0, 16, 0, 32);
        Button r = new Button(this); r.setText(R.string.retry);
        r.setOnClickListener(v -> { offline.setVisibility(View.GONE); web.reload(); });
        l.addView(t); l.addView(b); l.addView(r, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return l;
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri u = intent.getData();
        if (u != null && isOwn(u)) web.loadUrl(u.toString());
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req == FILE_REQ && fileCb != null) { fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data)); fileCb = null; return; }
        super.onActivityResult(req, res, data);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        if (offline.getVisibility() == View.VISIBLE) { offline.setVisibility(View.GONE); }
        // Close an open drawer / bottom sheet in the PWA first, then history, then exit.
        web.evaluateJavascript("(function(){var b=document.body,m=document.getElementById('modal');if(b.classList.contains('navopen')){b.classList.remove('navopen');return 1}if(m&&!m.hidden&&m.offsetParent!==null){m.click&&m.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));m.remove();return 1}return 0})()", r -> {
            if ("1".equals(r)) return;
            if (web.canGoBack()) web.goBack(); else finish();
        });
    }
}
