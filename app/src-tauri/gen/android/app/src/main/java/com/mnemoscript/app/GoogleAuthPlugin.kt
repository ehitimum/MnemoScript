package com.mnemoscript.app

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope

/** Only MnemoScript's own hidden Drive folder; never the writer's other files. */
private const val DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata"

@InvokeArg
class AuthorizeArgs {
  /** false = never show UI (silent refresh); true = Google may show its account/consent sheet. */
  var interactive: Boolean = true
}

/**
 * Google Drive authorization on Android through Google Play services' AuthorizationClient.
 * Google identifies the app by its package name and signing certificate (an "Android" OAuth
 * client in the writer's Google Cloud project), shows its own account and consent sheet, and
 * returns a short-lived access token. No password or refresh token is ever handled here.
 */
@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {
  private fun request(): AuthorizationRequest =
    AuthorizationRequest.builder().setRequestedScopes(listOf(Scope(DRIVE_APPDATA))).build()

  @Command
  fun authorize(invoke: Invoke) {
    val args = invoke.parseArgs(AuthorizeArgs::class.java)
    Identity.getAuthorizationClient(activity)
      .authorize(request())
      .addOnSuccessListener { result ->
        if (result.hasResolution()) {
          val pending = result.pendingIntent
          if (!args.interactive || pending == null) {
            invoke.reject("Google needs you to confirm Drive access")
            return@addOnSuccessListener
          }
          startIntentSenderForResult(invoke, IntentSenderRequest.Builder(pending.intentSender).build(), "onAuthorized")
        } else {
          resolve(invoke, result)
        }
      }
      .addOnFailureListener { e -> invoke.reject(e.message ?: "Google authorization failed") }
  }

  @ActivityCallback
  private fun onAuthorized(invoke: Invoke, result: ActivityResult) {
    try {
      resolve(invoke, Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(result.data))
    } catch (e: Exception) {
      invoke.reject("Google sign-in was cancelled")
    }
  }

  private fun resolve(invoke: Invoke, result: AuthorizationResult) {
    val token = result.accessToken
    if (token.isNullOrEmpty()) {
      invoke.reject("Google did not grant Drive access")
      return
    }
    val out = JSObject()
    out.put("accessToken", token)
    // Google access tokens last about an hour; the backend refreshes a little early.
    out.put("expiresIn", 3300)
    invoke.resolve(out)
  }
}
