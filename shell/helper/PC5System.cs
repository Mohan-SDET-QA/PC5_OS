// PC5System.exe - small Windows settings helper for PC5 Shell. Prints JSON.
//   PC5System.exe volume get              {"volume":42,"muted":false}
//   PC5System.exe volume set 55
//   PC5System.exe volume mute on|off|toggle
//   PC5System.exe audio list              [{"id":"...","name":"Speakers","default":true}, ...]
//   PC5System.exe audio set <id>          make an output device the default
//   PC5System.exe display get             {"width":1920,"height":1080,"hz":60,"modes":[...]}
//   PC5System.exe display set <w> <h> <hz>
// Build: helper\build-helper.ps1 (C# 5, the compiler that ships with Windows).
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

static class PC5System
{
    static int Main(string[] args)
    {
        try
        {
            string area = args.Length > 0 ? args[0] : "";
            string action = args.Length > 1 ? args[1] : "get";
            if (area == "volume") return Volume(action, args);
            if (area == "audio") return Audio(action, args);
            if (area == "display") return Display(action, args);
            Console.WriteLine("{\"error\":\"unknown command\"}");
            return 2;
        }
        catch (Exception e)
        {
            Console.WriteLine("{\"error\":" + Json(e.Message) + "}");
            return 1;
        }
    }

    // ------------------------------------------------------------------ volume
    static int Volume(string action, string[] args)
    {
        IAudioEndpointVolume vol = EndpointVolume();
        Guid ctx = Guid.Empty;
        if (action == "set")
        {
            float level = Math.Max(0, Math.Min(100, float.Parse(args[2], CultureInfo.InvariantCulture))) / 100f;
            Check(vol.SetMasterVolumeLevelScalar(level, ref ctx));
            if (level > 0) Check(vol.SetMute(false, ref ctx));
        }
        else if (action == "mute")
        {
            bool current;
            Check(vol.GetMute(out current));
            string mode = args.Length > 2 ? args[2] : "toggle";
            bool next = mode == "on" ? true : mode == "off" ? false : !current;
            Check(vol.SetMute(next, ref ctx));
        }
        float scalar;
        bool muted;
        Check(vol.GetMasterVolumeLevelScalar(out scalar));
        Check(vol.GetMute(out muted));
        Console.WriteLine("{\"volume\":" + Math.Round(scalar * 100).ToString(CultureInfo.InvariantCulture) + ",\"muted\":" + (muted ? "true" : "false") + "}");
        return 0;
    }

    static IAudioEndpointVolume EndpointVolume()
    {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice dev;
        Check(en.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out dev));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object o;
        Check(dev.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o));
        return (IAudioEndpointVolume)o;
    }

    // ------------------------------------------------------------------ output devices
    static int Audio(string action, string[] args)
    {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        if (action == "set")
        {
            IPolicyConfig policy = (IPolicyConfig)new PolicyConfigClient();
            for (int role = 0; role < 3; role++) Check(policy.SetDefaultEndpoint(args[2], role));
        }
        string defaultId = "";
        IMMDevice def;
        if (en.GetDefaultAudioEndpoint(0, 1, out def) == 0) Check(def.GetId(out defaultId));

        IMMDeviceCollection list;
        Check(en.EnumAudioEndpoints(0 /* eRender */, 1 /* DEVICE_STATE_ACTIVE */, out list));
        int count;
        Check(list.GetCount(out count));
        var sb = new StringBuilder("[");
        for (int i = 0; i < count; i++)
        {
            IMMDevice dev;
            Check(list.Item(i, out dev));
            string id;
            Check(dev.GetId(out id));
            if (i > 0) sb.Append(",");
            sb.Append("{\"id\":" + Json(id) + ",\"name\":" + Json(FriendlyName(dev)) + ",\"default\":" + (id == defaultId ? "true" : "false") + "}");
        }
        sb.Append("]");
        Console.WriteLine(sb.ToString());
        return 0;
    }

    static string FriendlyName(IMMDevice dev)
    {
        IPropertyStore store;
        if (dev.OpenPropertyStore(0 /* STGM_READ */, out store) != 0) return "Audio device";
        PROPERTYKEY key = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        PROPVARIANT v;
        if (store.GetValue(ref key, out v) != 0 || v.pointerValue == IntPtr.Zero) return "Audio device";
        return Marshal.PtrToStringUni(v.pointerValue);
    }

    // ------------------------------------------------------------------ display
    static int Display(string action, string[] args)
    {
        if (action == "set")
        {
            DEVMODE dm = NewDevMode();
            dm.dmPelsWidth = int.Parse(args[2]);
            dm.dmPelsHeight = int.Parse(args[3]);
            dm.dmDisplayFrequency = int.Parse(args[4]);
            dm.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
            int test = ChangeDisplaySettingsEx(null, ref dm, IntPtr.Zero, CDS_TEST, IntPtr.Zero);
            if (test != 0) throw new Exception("That display mode is not supported (" + test + ")");
            int r = ChangeDisplaySettingsEx(null, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY, IntPtr.Zero);
            if (r != 0) throw new Exception("Could not change the display mode (" + r + ")");
        }
        DEVMODE cur = NewDevMode();
        EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref cur);
        var seen = new HashSet<string>();
        var modes = new List<string>();
        DEVMODE m = NewDevMode();
        for (int i = 0; EnumDisplaySettings(null, i, ref m); i++)
        {
            if (m.dmBitsPerPel < 32 || m.dmPelsWidth < 1024) continue;
            string k = m.dmPelsWidth + "x" + m.dmPelsHeight + "@" + m.dmDisplayFrequency;
            if (!seen.Add(k)) continue;
            modes.Add("{\"width\":" + m.dmPelsWidth + ",\"height\":" + m.dmPelsHeight + ",\"hz\":" + m.dmDisplayFrequency + "}");
        }
        Console.WriteLine("{\"width\":" + cur.dmPelsWidth + ",\"height\":" + cur.dmPelsHeight + ",\"hz\":" + cur.dmDisplayFrequency +
            ",\"modes\":[" + string.Join(",", modes.ToArray()) + "]}");
        return 0;
    }

    static DEVMODE NewDevMode()
    {
        DEVMODE dm = new DEVMODE();
        dm.dmDeviceName = new string('\0', 32);
        dm.dmFormName = new string('\0', 32);
        dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        return dm;
    }

    // ------------------------------------------------------------------ helpers
    static void Check(int hr)
    {
        if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    }

    static string Json(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 32) sb.Append("\\u" + ((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    // ------------------------------------------------------------------ Core Audio COM
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")]
    class PolicyConfigClient { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    }

    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetAt(int index, out PROPERTYKEY key);
        [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
        [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
        [PreserveSig] int Commit();
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROPERTYKEY { public Guid fmtid; public int pid; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr pointerValue; }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out int count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid ctx);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(int channel, float levelDb, ref Guid ctx);
        [PreserveSig] int SetChannelVolumeLevelScalar(int channel, float level, ref Guid ctx);
        [PreserveSig] int GetChannelVolumeLevel(int channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(int channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    // Undocumented but long-stable interface used to change the default output device.
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat(IntPtr a, IntPtr b);
        [PreserveSig] int GetDeviceFormat(IntPtr a, int b, IntPtr c);
        [PreserveSig] int ResetDeviceFormat(IntPtr a);
        [PreserveSig] int SetDeviceFormat(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int GetProcessingPeriod(IntPtr a, int b, IntPtr c, IntPtr d);
        [PreserveSig] int SetProcessingPeriod(IntPtr a, IntPtr b);
        [PreserveSig] int GetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int SetShareMode(IntPtr a, IntPtr b);
        [PreserveSig] int GetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int SetPropertyValue(IntPtr a, IntPtr b, IntPtr c);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string deviceId, int visible);
    }

    // ------------------------------------------------------------------ display API
    const int ENUM_CURRENT_SETTINGS = -1;
    const int CDS_UPDATEREGISTRY = 0x01, CDS_TEST = 0x02;
    const int DM_PELSWIDTH = 0x80000, DM_PELSHEIGHT = 0x100000, DM_DISPLAYFREQUENCY = 0x400000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields;
        public int dmPositionX, dmPositionY;
        public int dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int ChangeDisplaySettingsEx(string deviceName, ref DEVMODE devMode, IntPtr hwnd, int flags, IntPtr param);
}
