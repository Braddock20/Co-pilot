package com.example.app;

import android.os.Bundle;
import android.widget.TextView;
import androidx.appcompat.app.AppCompatActivity;
import com.google.android.material.button.MaterialButton;

/**
 * Starter MainActivity.
 *
 * The agent will likely rewrite this file to match the user's app description.
 * It currently:
 *   - Sets a content view from the starter layout (so the app doesn't look empty)
 *   - Demonstrates the proper button-wiring pattern (findViewById + setOnClickListener)
 *   - Shows a few common Material Design idioms the agent can copy from
 *
 * Java is used (not Kotlin) because the project is set up for Java. ViewBinding
 * is enabled in build.gradle, so the agent can also use ActivityMainBinding if
 * it prefers. Both approaches work.
 */
public class MainActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        // Wire the views — this is the pattern the agent should follow for any
        // new button or interactive view.
        TextView titleText = findViewById(R.id.titleText);
        TextView subtitleText = findViewById(R.id.subtitleText);
        MaterialButton primaryButton = findViewById(R.id.primaryButton);

        titleText.setText(R.string.app_name);
        subtitleText.setText("The agent should replace this with the real UI.");
        primaryButton.setText("Do something");

        // ALWAYS wire button clicks like this. NEVER use android:onClick in XML —
        // it breaks on older devices and the model gets it wrong constantly.
        primaryButton.setOnClickListener(v -> {
            subtitleText.setText("Button clicked at " + System.currentTimeMillis());
        });
    }
}
