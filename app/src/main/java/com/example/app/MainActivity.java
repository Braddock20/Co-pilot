package com.example.app;

import android.os.Bundle;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The agent will likely replace this with setContentView(R.layout.activity_main)
        setContentView(new android.widget.TextView(this) {{
            setText("Empty starter app — agent, do your thing.");
            setTextSize(20);
            setPadding(48, 48, 48, 48);
        }});
    }
}
