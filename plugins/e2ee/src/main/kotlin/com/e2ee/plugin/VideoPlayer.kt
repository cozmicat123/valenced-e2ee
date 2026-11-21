// AI-written glue. Discord's viewer cannot play a local file (tested on device: black 0:00 for file://, never connects to a
// loopback server), so decrypted videos play in Android's own VideoView. Activity access: Valenced HostScope.withAppActivity
// (valenced-plugin-template MyPlugin.kt).
package com.e2ee.plugin

import android.app.Activity
import android.app.Dialog
import android.net.Uri
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.VideoView
import java.io.File

object VideoPlayer {
    /** Plays [uri] (the file:// address Discord's viewer was opened with) if it is a video we decrypted. False for anything else. */
    fun play(activity: Activity, uri: String): Boolean {
        val file = File(Uri.parse(uri).path ?: return false)
        if (!file.isFile || file.parentFile?.canonicalFile != E2eeFiles.playDir.canonicalFile) return false
        activity.runOnUiThread { show(activity, file) }
        return true
    }

    private fun show(activity: Activity, file: File) {
        val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val video = VideoView(activity)
        video.setMediaController(MediaController(activity).also { it.setAnchorView(video) })
        video.setVideoPath(file.path)
        video.setOnPreparedListener { video.start() }
        video.setOnErrorListener { _, _, _ ->
            dialog.dismiss()
            true
        }
        dialog.setOnDismissListener { video.stopPlayback() }
        dialog.setContentView(
            FrameLayout(activity).apply {
                setBackgroundColor(0xFF000000.toInt())
                addView(video, FrameLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT, Gravity.CENTER))
                layoutParams = FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT)
            },
        )
        dialog.show()
    }
}
