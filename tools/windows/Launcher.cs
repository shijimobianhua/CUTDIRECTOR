using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class Launcher
{
    private static string workbench;
    private static int port;
    private const int Missing = 0, Compatible = 1, Other = 2;

    [STAThread]
    public static int Main(string[] args)
    {
        var verify = Array.IndexOf(args, "--verify-launch") >= 0;
        try
        {
            port = 7793;
            var overridePort = verify ? Environment.GetEnvironmentVariable("CUTDIRECTOR_VERIFY_PORT") : null;
            if (!String.IsNullOrEmpty(overridePort) && (!Int32.TryParse(overridePort, out port) || port < 1024 || port > 65535))
                throw new InvalidOperationException("测试端口无效。");
            workbench = "http://127.0.0.1:" + port + "/";
            using (var mutex = new Mutex(false, @"Local\CUTDIRECTOR.Workbench.Start." + port))
            {
                bool acquired;
                try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(20)); }
                catch (AbandonedMutexException) { acquired = true; }
                if (!acquired) throw new InvalidOperationException("正在启动另一份 CUTDIRECTOR，请稍后再试。");
                try
                {
                    EnsureWriter(verify);
                    if (!verify) Process.Start(new ProcessStartInfo(workbench) { UseShellExecute = true });
                }
                finally { mutex.ReleaseMutex(); }
            }
            return 0;
        }
        catch (Exception error)
        {
            var verifyLog = verify ? Environment.GetEnvironmentVariable("CUTDIRECTOR_VERIFY_LOG") : null;
            if (!String.IsNullOrEmpty(verifyLog)) File.WriteAllText(verifyLog, error.Message);
            if (!verify) MessageBox.Show(error.Message, "CUTDIRECTOR", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }

    private static int Probe()
    {
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(workbench + "agent/launcher");
            request.Timeout = 800;
            request.ReadWriteTimeout = 800;
            request.AllowAutoRedirect = false;
            request.Proxy = null;
            using (var response = (HttpWebResponse)request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream()))
                return reader.ReadToEnd() == "{\"product\":\"CUTDIRECTOR\",\"protocol\":3}" ? Compatible : Other;
        }
        catch (WebException error)
        {
            if (error.Response != null) error.Response.Dispose();
            using (var socket = new TcpClient())
            {
                try { socket.Connect(IPAddress.Loopback, port); }
                catch (SocketException socketError)
                {
                    if (socketError.SocketErrorCode == SocketError.ConnectionRefused) return Missing;
                }
            }
            return Other;
        }
    }

    private static void EnsureWriter(bool verify)
    {
        var status = Probe();
        if (status == Compatible) return;
        if (status == Other) throw new InvalidOperationException("端口 " + port + " 已被占用，或正在运行较早版本的 CUTDIRECTOR。请关闭占用程序后重试。");

        var root = AppDomain.CurrentDomain.BaseDirectory;
        var appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CUTDIRECTOR");
        var pointer = Path.Combine(appData, "data-dir.txt");
        var data = File.Exists(pointer) ? File.ReadAllText(pointer).Trim() : Path.Combine(appData, "projects");
        var verifyData = verify ? Environment.GetEnvironmentVariable("CUTDIRECTOR_VERIFY_DATA") : null;
        if (!String.IsNullOrEmpty(verifyData)) data = verifyData;
        if (!Path.IsPathRooted(data)) throw new InvalidOperationException("工程目录无效。");
        Directory.CreateDirectory(data);
        var start = new ProcessStartInfo(Path.Combine(root, @"runtime\node.exe"), "\"" + Path.Combine(root, @"src\server.cjs") + "\"");
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.EnvironmentVariables["PORT"] = port.ToString();
        start.EnvironmentVariables["VIDEO_DATA"] = data;
        start.EnvironmentVariables["FFMPEG"] = Path.Combine(root, @"runtime\ffmpeg\ffmpeg.exe");
        start.EnvironmentVariables["FFPROBE"] = Path.Combine(root, @"runtime\ffmpeg\ffprobe.exe");
        using (var child = Process.Start(start))
        {
            for (var i = 0; i < 42; i++)
            {
                if (Probe() == Compatible) return;
                if (child.HasExited) throw new InvalidOperationException("CUTDIRECTOR 服务退出，代码 " + child.ExitCode + "。");
                Thread.Sleep(250);
            }
        }
        throw new InvalidOperationException("CUTDIRECTOR 服务未能启动。请检查工程目录是否被另一实例占用。");
    }
}
