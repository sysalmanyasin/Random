package com.duapharma.auditwidget

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

class LoginActivity : AppCompatActivity() {

    private val executor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        val phoneInput = findViewById<EditText>(R.id.inputPhone)
        val pinInput = findViewById<EditText>(R.id.inputPin)
        val loginButton = findViewById<Button>(R.id.buttonLogin)
        val statusText = findViewById<TextView>(R.id.statusText)
        val progressBar = findViewById<ProgressBar>(R.id.progressBar)

        if (TokenStore.isLoggedIn(this)) {
            val name = TokenStore.auditorName(this)
            statusText.text = if (name != null) {
                "Logged in as $name. Add the widget to your home screen (long-press home screen → Widgets → ${getString(R.string.app_name)})."
            } else {
                getString(R.string.login_success)
            }
            phoneInput.isEnabled = false
            pinInput.isEnabled = false
            loginButton.text = "Log Out"
            loginButton.setOnClickListener {
                TokenStore.clear(this)
                recreate()
            }
            return
        }

        loginButton.setOnClickListener {
            val phone = phoneInput.text.toString().trim()
            val pin = pinInput.text.toString().trim()
            if (phone.isEmpty() || pin.isEmpty()) {
                statusText.text = "Enter both phone and PIN"
                return@setOnClickListener
            }

            progressBar.visibility = android.view.View.VISIBLE
            statusText.text = ""
            loginButton.isEnabled = false

            executor.execute {
                try {
                    val session = SupabaseAuth.login(phone, pin)
                    TokenStore.saveSession(
                        this,
                        session.accessToken,
                        session.refreshToken,
                        session.expiresAtEpochSeconds,
                        session.userId,
                        auditorName = null // resolved lazily on first widget fetch
                    )
                    runOnUiThread {
                        progressBar.visibility = android.view.View.GONE
                        statusText.text = getString(R.string.login_success)
                        loginButton.isEnabled = true
                        IndividualRoundsWidgetProvider.refreshAll(this)
                        IndividualRoundsWidgetProvider.schedulePeriodicRefresh(this)
                        recreate()
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        progressBar.visibility = android.view.View.GONE
                        statusText.text = e.message ?: getString(R.string.login_error)
                        loginButton.isEnabled = true
                    }
                }
            }
        }
    }
}
