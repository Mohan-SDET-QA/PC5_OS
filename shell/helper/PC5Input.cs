// PC5Input.exe - system-wide controller service for PC5 Shell.
//
//  * Reads Xbox controllers (XInput) and PS4 DualShock 4 / PS5 DualSense
//    controllers (raw HID, USB and Bluetooth) - no DS4Windows needed.
//  * PS / Guide button (or Back+Start held 1s): brings PC5 Shell back from any game or app.
//  * Mouse mode (hold Share/Create/View 1s, or requested by the shell):
//      left stick = pointer, Cross/A = left click, Square/X = right click,
//      right stick = scroll, D-pad = arrow keys, Options/Start = Enter,
//      Circle/B = Esc, L1/R1 = Shift+Tab/Tab, Triangle/Y = Windows on-screen keyboard.
//    This makes ordinary Windows programs (installers, the desktop) usable without a mouse.
//
// Talks to the shell over a localhost TCP socket: PC5Input.exe <port> <token>
// Sends: HELLO <token>, HOME, MOUSE ON, MOUSE OFF, PADS <n>, CAPTURE   Receives: MOUSE ON, MOUSE OFF
// Build: helper\build-helper.ps1 (uses the C# compiler that ships with Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

class PadState
{
    public bool A, B, X, Y, LB, RB, Back, Start, L3, R3, Up, Down, Left, Right, Guide;
    public float LX, LY, RX, RY; // -1..1, Y positive = down
    public DateTime Seen = DateTime.UtcNow;
}

static class Program
{
    static readonly object Sync = new object();
    static readonly Dictionary<string, PadState> Pads = new Dictionary<string, PadState>();
    static readonly HashSet<string> OpenHid = new HashSet<string>();
    static StreamWriter Out;
    static volatile bool MouseMode;

    static void Main(string[] args)
    {
        if (args.Length < 2) return;
        var client = new TcpClient();
        client.Connect("127.0.0.1", int.Parse(args[0]));
        var stream = client.GetStream();
        Out = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        Send("HELLO " + args[1]);
        new Thread(() => ReadCommands(new StreamReader(stream))) { IsBackground = true }.Start();
        new Thread(HidScanner) { IsBackground = true }.Start();
        MainLoop();
    }

    static void Send(string line)
    {
        try { lock (Out) Out.WriteLine(line); }
        catch { Environment.Exit(0); } // shell went away
    }

    static void ReadCommands(StreamReader reader)
    {
        try
        {
            string line;
            while ((line = reader.ReadLine()) != null)
            {
                if (line == "MOUSE ON") MouseMode = true;
                else if (line == "MOUSE OFF") MouseMode = false;
            }
        }
        catch { }
        Environment.Exit(0);
    }

    // ------------------------------------------------------------------ main loop
    static void MainLoop()
    {
        var prev = new PadState();
        DateTime? backSince = null, comboSince = null;
        bool backFired = false, comboFired = false;
        float accX = 0, accY = 0, accWheel = 0;
        int lastCount = -1;

        while (true)
        {
            PollXInput();
            int count;
            PadState s = Merge(out count);
            if (count != lastCount) { Send("PADS " + count); lastCount = count; }

            if (s.Guide && !prev.Guide) GoHome();

            // Back+Start held 1s = Home (for controllers whose Guide button is reserved).
            bool combo = s.Back && s.Start;
            if (!combo) { comboSince = null; comboFired = false; }
            else if (comboSince == null) comboSince = DateTime.UtcNow;
            else if (!comboFired && (DateTime.UtcNow - comboSince.Value).TotalMilliseconds > 1000) { comboFired = true; GoHome(); }

            // Back/Share/Create held alone for 1s toggles mouse mode; a short tap
            // (released within 0.4s) reports CAPTURE (screenshot, if enabled in PC5).
            bool backAlone = s.Back && !s.Start;
            if (!backAlone && prev.Back && !prev.Start && backSince != null && !backFired &&
                (DateTime.UtcNow - backSince.Value).TotalMilliseconds < 400) Send("CAPTURE");
            if (!backAlone) { backSince = null; backFired = false; }
            else if (backSince == null) backSince = DateTime.UtcNow;
            else if (!backFired && (DateTime.UtcNow - backSince.Value).TotalMilliseconds > 1000)
            {
                backFired = true;
                MouseMode = !MouseMode;
                Send(MouseMode ? "MOUSE ON" : "MOUSE OFF");
            }

            if (MouseMode)
            {
                accX += Curve(s.LX) * 16f;
                accY += Curve(s.LY) * 16f;
                int dx = (int)accX, dy = (int)accY;
                accX -= dx; accY -= dy;
                if (dx != 0 || dy != 0) Mouse(MOUSEEVENTF_MOVE, dx, dy, 0);

                accWheel += -Curve(s.RY) * 18f;
                int wheel = (int)accWheel;
                accWheel -= wheel;
                if (wheel != 0) Mouse(MOUSEEVENTF_WHEEL, 0, 0, wheel);

                if (s.A != prev.A) Mouse(s.A ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP, 0, 0, 0);
                if (s.X != prev.X) Mouse(s.X ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP, 0, 0, 0);
                if (s.Up && !prev.Up) Key(VK_UP, true);
                if (s.Down && !prev.Down) Key(VK_DOWN, true);
                if (s.Left && !prev.Left) Key(VK_LEFT, true);
                if (s.Right && !prev.Right) Key(VK_RIGHT, true);
                if (s.Start && !prev.Start && !s.Back) Key(VK_RETURN, false);
                if (s.B && !prev.B) Key(VK_ESCAPE, false);
                if (s.RB && !prev.RB) Key(VK_TAB, false);
                if (s.LB && !prev.LB) { KeyDown(VK_SHIFT); Key(VK_TAB, false); KeyUp(VK_SHIFT); }
                if (s.Y && !prev.Y) ToggleOnScreenKeyboard();
            }
            prev = s;
            Thread.Sleep(10);
        }
    }

    static void GoHome()
    {
        if (MouseMode) { MouseMode = false; Send("MOUSE OFF"); }
        Send("HOME");
    }

    static float Curve(float v)
    {
        const float dead = 0.18f;
        float a = Math.Abs(v);
        if (a < dead) return 0;
        float n = (a - dead) / (1 - dead);
        return Math.Sign(v) * n * n;
    }

    static PadState Merge(out int count)
    {
        var m = new PadState();
        count = 0;
        lock (Sync)
        {
            foreach (var p in Pads.Values)
            {
                if ((DateTime.UtcNow - p.Seen).TotalSeconds > 2) continue;
                count++;
                m.A |= p.A; m.B |= p.B; m.X |= p.X; m.Y |= p.Y; m.LB |= p.LB; m.RB |= p.RB;
                m.Back |= p.Back; m.Start |= p.Start; m.L3 |= p.L3; m.R3 |= p.R3; m.Guide |= p.Guide;
                m.Up |= p.Up; m.Down |= p.Down; m.Left |= p.Left; m.Right |= p.Right;
                if (Math.Abs(p.LX) > Math.Abs(m.LX)) m.LX = p.LX;
                if (Math.Abs(p.LY) > Math.Abs(m.LY)) m.LY = p.LY;
                if (Math.Abs(p.RX) > Math.Abs(m.RX)) m.RX = p.RX;
                if (Math.Abs(p.RY) > Math.Abs(m.RY)) m.RY = p.RY;
            }
        }
        return m;
    }

    // ------------------------------------------------------------------ XInput (Xbox)
    [StructLayout(LayoutKind.Sequential)]
    struct XInputGamepad { public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
    [StructLayout(LayoutKind.Sequential)]
    struct XInputState { public uint Packet; public XInputGamepad Pad; }

    // Ordinal 100 = XInputGetStateEx, which also reports the Guide button.
    [DllImport("xinput1_4.dll", EntryPoint = "#100")]
    static extern uint XInputGetStateEx(uint index, ref XInputState state);

    static void PollXInput()
    {
        for (uint i = 0; i < 4; i++)
        {
            var st = new XInputState();
            string key = "xinput" + i;
            if (XInputGetStateEx(i, ref st) != 0) { lock (Sync) Pads.Remove(key); continue; }
            ushort b = st.Pad.Buttons;
            var p = new PadState
            {
                Up = (b & 0x0001) != 0, Down = (b & 0x0002) != 0, Left = (b & 0x0004) != 0, Right = (b & 0x0008) != 0,
                Start = (b & 0x0010) != 0, Back = (b & 0x0020) != 0, L3 = (b & 0x0040) != 0, R3 = (b & 0x0080) != 0,
                LB = (b & 0x0100) != 0, RB = (b & 0x0200) != 0, Guide = (b & 0x0400) != 0,
                A = (b & 0x1000) != 0, B = (b & 0x2000) != 0, X = (b & 0x4000) != 0, Y = (b & 0x8000) != 0,
                LX = st.Pad.LX / 32767f, LY = -st.Pad.LY / 32767f, RX = st.Pad.RX / 32767f, RY = -st.Pad.RY / 32767f,
            };
            lock (Sync) Pads[key] = p;
        }
    }

    // ------------------------------------------------------------------ HID (PlayStation)
    const ushort SONY = 0x054C;
    static readonly ushort[] DualShock4 = { 0x05C4, 0x09CC, 0x0BA0 };
    static readonly ushort[] DualSense = { 0x0CE6, 0x0DF2 }; // DualSense, DualSense Edge

    static void HidScanner()
    {
        while (true)
        {
            try
            {
                foreach (string path in EnumerateHid())
                {
                    lock (Sync) if (OpenHid.Contains(path)) continue;
                    TryOpen(path);
                }
            }
            catch { }
            Thread.Sleep(3000);
        }
    }

    static void TryOpen(string path)
    {
        var h = CreateFile(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        if (h.IsInvalid) h = CreateFile(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        if (h.IsInvalid) return;
        var attr = new HIDD_ATTRIBUTES { Size = Marshal.SizeOf(typeof(HIDD_ATTRIBUTES)) };
        if (!HidD_GetAttributes(h, ref attr) || attr.VendorID != SONY) { h.Dispose(); return; }
        bool isDualSense = DualSense.Contains(attr.ProductID);
        if (!isDualSense && !DualShock4.Contains(attr.ProductID)) { h.Dispose(); return; }

        int len = 64;
        IntPtr pre;
        if (HidD_GetPreparsedData(h, out pre))
        {
            var caps = new HIDP_CAPS();
            if (HidP_GetCaps(pre, ref caps) == HIDP_STATUS_SUCCESS) len = caps.InputReportByteLength;
            HidD_FreePreparsedData(pre);
        }
        if (len <= 0) { h.Dispose(); return; }
        bool usb = len == 64; // Bluetooth reports are longer (DualSense 78, DS4 547)

        lock (Sync) OpenHid.Add(path);
        new Thread(() => ReadHid(path, h, len, isDualSense, usb)) { IsBackground = true }.Start();
    }

    static void ReadHid(string path, SafeFileHandle h, int len, bool isDualSense, bool usb)
    {
        try
        {
            using (var fs = new FileStream(h, FileAccess.Read, len, false))
            {
                var buf = new byte[len];
                while (true)
                {
                    int n = fs.Read(buf, 0, len);
                    if (n <= 0) break;
                    var p = Parse(buf, n, isDualSense, usb);
                    if (p != null) lock (Sync) Pads[path] = p;
                }
            }
        }
        catch { }
        finally
        {
            lock (Sync) { Pads.Remove(path); OpenHid.Remove(path); }
            h.Dispose();
        }
    }

    static PadState Parse(byte[] b, int n, bool isDualSense, bool usb)
    {
        if (isDualSense)
        {
            if (b[0] == 0x01 && usb && n >= 11) return DualSenseLayout(b, 0);  // USB full report
            if (b[0] == 0x31 && n >= 12) return DualSenseLayout(b, 1);         // Bluetooth full report
            if (b[0] == 0x01 && n >= 8) return Ds4Layout(b, 0);                // Bluetooth simple report
            return null;
        }
        if (b[0] == 0x01 && n >= 8) return Ds4Layout(b, 0);                    // USB, or Bluetooth basic
        if (b[0] == 0x11 && n >= 10) return Ds4Layout(b, 2);                   // Bluetooth full report
        return null;
    }

    static PadState Ds4Layout(byte[] b, int o) { return Buttons(b, o, b[o + 5], b[o + 6], b[o + 7]); }
    static PadState DualSenseLayout(byte[] b, int o) { return Buttons(b, o, b[o + 8], b[o + 9], b[o + 10]); }

    static PadState Buttons(byte[] b, int o, byte face, byte shoulder, byte sys)
    {
        int dpad = face & 0x0F; // 0=N, clockwise to 7=NW, 8=released
        return new PadState
        {
            LX = (b[o + 1] - 128) / 127f, LY = (b[o + 2] - 128) / 127f,
            RX = (b[o + 3] - 128) / 127f, RY = (b[o + 4] - 128) / 127f,
            Up = dpad == 7 || dpad == 0 || dpad == 1, Right = dpad >= 1 && dpad <= 3,
            Down = dpad >= 3 && dpad <= 5, Left = dpad >= 5 && dpad <= 7,
            X = (face & 0x10) != 0,  // Square
            A = (face & 0x20) != 0,  // Cross
            B = (face & 0x40) != 0,  // Circle
            Y = (face & 0x80) != 0,  // Triangle
            LB = (shoulder & 0x01) != 0, RB = (shoulder & 0x02) != 0,
            Back = (shoulder & 0x10) != 0,  // Share / Create
            Start = (shoulder & 0x20) != 0, // Options
            L3 = (shoulder & 0x40) != 0, R3 = (shoulder & 0x80) != 0,
            Guide = (sys & 0x01) != 0,      // PS button
        };
    }

    static IEnumerable<string> EnumerateHid()
    {
        Guid guid;
        HidD_GetHidGuid(out guid);
        IntPtr set = SetupDiGetClassDevs(ref guid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
        var result = new List<string>();
        try
        {
            var data = new SP_DEVICE_INTERFACE_DATA { cbSize = Marshal.SizeOf(typeof(SP_DEVICE_INTERFACE_DATA)) };
            for (uint i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref guid, i, ref data); i++)
            {
                uint size;
                SetupDiGetDeviceInterfaceDetail(set, ref data, IntPtr.Zero, 0, out size, IntPtr.Zero);
                IntPtr detail = Marshal.AllocHGlobal((int)size);
                try
                {
                    Marshal.WriteInt32(detail, IntPtr.Size == 8 ? 8 : 6);
                    if (SetupDiGetDeviceInterfaceDetail(set, ref data, detail, size, out size, IntPtr.Zero))
                    {
                        string path = Marshal.PtrToStringUni(detail + 4);
                        // Cheap pre-filter on the device path before opening anything.
                        if (path != null && path.IndexOf("054c", StringComparison.OrdinalIgnoreCase) >= 0) result.Add(path);
                    }
                }
                finally { Marshal.FreeHGlobal(detail); }
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return result;
    }

    // ------------------------------------------------------------------ mouse / keyboard output
    static void ToggleOnScreenKeyboard()
    {
        var running = Process.GetProcessesByName("osk");
        if (running.Length > 0) { foreach (var p in running) try { p.Kill(); } catch { } return; }
        try { Process.Start(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "osk.exe")); } catch { }
    }

    static void Mouse(uint flags, int dx, int dy, int data)
    {
        var input = new INPUT { type = INPUT_MOUSE };
        input.u.mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = (uint)data, dwFlags = flags };
        SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

    static void KeyEvent(ushort vk, uint flags)
    {
        var input = new INPUT { type = INPUT_KEYBOARD };
        input.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = flags };
        SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }
    static void KeyDown(ushort vk) { KeyEvent(vk, 0); }
    static void KeyUp(ushort vk) { KeyEvent(vk, KEYEVENTF_KEYUP); }
    static void Key(ushort vk, bool extended)
    {
        uint ext = extended ? KEYEVENTF_EXTENDEDKEY : 0;
        KeyEvent(vk, ext);
        KeyEvent(vk, ext | KEYEVENTF_KEYUP);
    }

    // ------------------------------------------------------------------ Win32
    const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
    const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3;
    const uint DIGCF_PRESENT = 0x2, DIGCF_DEVICEINTERFACE = 0x10;
    const int HIDP_STATUS_SUCCESS = 0x00110000;
    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_MOVE = 0x1, MOUSEEVENTF_LEFTDOWN = 0x2, MOUSEEVENTF_LEFTUP = 0x4;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x8, MOUSEEVENTF_RIGHTUP = 0x10, MOUSEEVENTF_WHEEL = 0x800;
    const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2;
    const ushort VK_TAB = 0x09, VK_RETURN = 0x0D, VK_SHIFT = 0x10, VK_ESCAPE = 0x1B;
    const ushort VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28;

    [StructLayout(LayoutKind.Sequential)]
    struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID, ProductID, VersionNumber; }

    [StructLayout(LayoutKind.Sequential)]
    struct HIDP_CAPS
    {
        public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
        public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices,
            NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices,
            NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid guid);
    [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES attr);
    [DllImport("hid.dll")] static extern bool HidD_GetPreparsedData(SafeFileHandle h, out IntPtr data);
    [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data, ref HIDP_CAPS caps);
    [DllImport("setupapi.dll", SetLastError = true)]
    static extern IntPtr SetupDiGetClassDevs(ref Guid guid, IntPtr enumerator, IntPtr parent, uint flags);
    [DllImport("setupapi.dll", SetLastError = true)]
    static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr devInfo, ref Guid guid, uint index, ref SP_DEVICE_INTERFACE_DATA data);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data, IntPtr detail, uint size, out uint required, IntPtr devInfo);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint count, INPUT[] inputs, int size);
}
