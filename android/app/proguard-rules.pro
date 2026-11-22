-dontusemixedcaseclassnames
-dontskipnonpubliclibraryclasses
-keepattributes *Annotation*,JavascriptInterface,Signature,InnerClasses,EnclosingMethod

-keep public class ru.klevpro.app.MainActivity {
    public protected *;
}

-keep public class ru.klevpro.app.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
    public <init>(...);
}

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep public class ru.klevpro.app.NavService {
    public protected *;
}
