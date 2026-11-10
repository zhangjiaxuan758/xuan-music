package com.music.adm

import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.getcapacitor.BridgeActivity

/** 小轩音乐：强制横屏 + 沉浸式全屏，内容铺满含摄像头挖孔在内的整块屏幕。 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
                super.onCreate(savedInstanceState)
        applyFullscreen()

        // Capacitor 的 StatusBar / SplashScreen 插件会在 WebView 初始化后调整窗口属性，
        // 延迟补两次，确保系统栏不会重新露出、挖孔区域不会被重新加黑边。
        window.decorView.postDelayed({ applyFullscreen() }, 600)
        window.decorView.postDelayed({ applyFullscreen() }, 1800)
    }

    private fun applyFullscreen() {
        // Android 15/16 强制 edge-to-edge：内容延伸至系统栏区域。
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }

        // 挖孔 / 刘海：ALWAYS 允许内容铺到任意一边的摄像头区域。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val lp = window.attributes
            lp.layoutInDisplayCutoutMode =
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                } else {
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            window.attributes = lp
        }

        WindowCompat.getInsetsController(window, window.decorView)?.let { controller ->
            controller.hide(WindowInsetsCompat.Type.systemBars())
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyFullscreen()
    }

    override fun onResume() {
        super.onResume()
        applyFullscreen()
    }
}
