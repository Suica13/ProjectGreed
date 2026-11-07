using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ProjectGreed.Client {
    internal static class Program {
        [STAThread]
        private static void Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var mutex = new Mutex(true, "Local\\ProjectGreed.AppTest2", out bool first)) {
                if (!first) { MessageBox.Show("ProjectGreed 已在运行。", "ProjectGreed"); return; }
                try { Application.Run(new GameWindow(args)); }
                catch (Exception error) { MessageBox.Show("客户端未能启动：" + error.Message, "ProjectGreed"); }
            }
        }
    }
    internal sealed class GameWindow : Form {
        private readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
        private readonly string dataDirectory;
        private readonly int testPort;
        private readonly string testExportDirectory;
        private bool fullScreen;
        private Rectangle restoreBounds;
        private FormWindowState restoreState;
        public GameWindow(string[] args) {
            Text = "ProjectGreed V95";
            ClientSize = new Size(1440, 900);
            MinimumSize = new Size(360, 480);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(21, 36, 48);
            dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ProjectGreed", "AppTest2");
            // Test-only flags are opt-in. Production launches never expose a debugging port.
            for (int i = 0; i + 1 < args.Length; i++) {
                if (args[i] == "--app-test-export") testExportDirectory = Path.GetFullPath(args[i + 1]);
                if (args[i] == "--app-test-data") dataDirectory = Path.GetFullPath(args[i + 1]);
                if (args[i] == "--app-test-port" && int.TryParse(args[i + 1], out int port) && port >= 1024 && port <= 65535) testPort = port;
            }
            Controls.Add(view);
            Shown += async (_, __) => {
                try {
                    var content = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "content");
                    if (!File.Exists(Path.Combine(content, "client.html"))) throw new FileNotFoundException("缺少客户端资源 content/client.html，请完整解压客户端文件夹。");
                    var options = new CoreWebView2EnvironmentOptions();
                    if (testPort != 0) options.AdditionalBrowserArguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + testPort;
                    var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDirectory, "webview"), options);
                    await view.EnsureCoreWebView2Async(environment);
                    var core = view.CoreWebView2;
                    if (int.Parse(environment.BrowserVersionString.Split('.')[0]) < 120) throw new InvalidOperationException("WebView2 版本过旧，请更新至120或更新版本。");
                    core.Settings.AreDefaultContextMenusEnabled = testPort != 0;
                    core.Settings.AreDevToolsEnabled = testPort != 0;
                    core.Settings.IsStatusBarEnabled = false;
                    core.Settings.IsZoomControlEnabled = true;
                    core.SetVirtualHostNameToFolderMapping("projectgreed.localhost", content, CoreWebView2HostResourceAccessKind.Deny);
                    core.AddHostObjectToScript("projectGreed", new NativeStore(dataDirectory));
                    core.NavigationStarting += (_, e) => {
                        if (IsAppUri(e.Uri)) return;
                        e.Cancel = true;
                        if (e.IsUserInitiated) OpenExternal(e.Uri);
                    };
                    core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenExternal(e.Uri); };
                    core.DownloadStarting += (_, e) => e.Cancel = true;
                    core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
                    core.WebMessageReceived += (_, e) => {
                        if (!IsAppUri(e.Source)) return;
                        var message = new JavaScriptSerializer { MaxJsonLength = NativeStore.MaxBytes * 2 }.Deserialize<System.Collections.Generic.Dictionary<string, string>>(e.WebMessageAsJson);
                        if (message.TryGetValue("action", out string action)) {
                            if (action == "exit") BeginInvoke(new Action(Close));
                            if (action == "export") BeginInvoke(new Action(() => Export(message)));
                            if (action == "fullscreen") BeginInvoke(new Action(ToggleFullScreen));
                        }
                    };
                    core.ProcessFailed += (_, e) => MessageBox.Show("网页渲染进程异常，请关闭并重新打开客户端。已保存的数据会保留。\n" + e.ProcessFailedKind, "ProjectGreed");
                    core.ContainsFullScreenElementChanged += (_, __) => {
                        if (core.ContainsFullScreenElement != fullScreen) BeginInvoke(new Action(ToggleFullScreen));
                    };
                    core.Navigate("http://projectgreed.localhost/client.html");
                } catch (WebView2RuntimeNotFoundException) {
                    MessageBox.Show("未安装 Microsoft Edge WebView2 Runtime。请从微软官网下载并安装 Evergreen Runtime 后重试。", "ProjectGreed");
                    Close();
                } catch (Exception error) { MessageBox.Show("客户端加载失败：" + error.Message, "ProjectGreed"); Close(); }
            };
        }
        private static bool IsAppUri(string value) {
            return Uri.TryCreate(value, UriKind.Absolute, out Uri uri) && uri.Scheme == "http" && uri.Host == "projectgreed.localhost" && uri.IsDefaultPort;
        }
        private static void OpenExternal(string value) {
            if (Uri.TryCreate(value, UriKind.Absolute, out Uri uri) && (uri.Scheme == "http" || uri.Scheme == "https"))
                try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch { }
        }
        private void ToggleFullScreen() {
            if (!fullScreen) {
                restoreBounds = Bounds; restoreState = WindowState;
                WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None;
                Bounds = Screen.FromControl(this).Bounds;
            } else {
                FormBorderStyle = FormBorderStyle.Sizable; Bounds = restoreBounds; WindowState = restoreState;
            }
            fullScreen = !fullScreen;
        }
        private void Export(System.Collections.Generic.Dictionary<string, string> message) {
            try {
                if (message["data"].Length > NativeStore.MaxBytes * 4L / 3L + 8) throw new IOException("导出文件过大");
                var bytes = Convert.FromBase64String(message["data"]);
                if (bytes.Length > NativeStore.MaxBytes) throw new IOException("导出文件过大");
                if (testExportDirectory != null) {
                    Directory.CreateDirectory(testExportDirectory);
                    File.WriteAllBytes(Path.Combine(testExportDirectory, Path.GetFileName(message["name"])), bytes);
                    return;
                }
                using (var dialog = new SaveFileDialog { FileName = Path.GetFileName(message["name"]), OverwritePrompt = true, RestoreDirectory = true }) {
                    if (dialog.ShowDialog(this) != DialogResult.OK) return;
                    using (var stream = new FileStream(dialog.FileName, FileMode.Create, FileAccess.Write)) {
                        stream.Write(bytes, 0, bytes.Length); stream.Flush(true);
                    }
                }
            } catch (Exception error) { MessageBox.Show("导出失败：" + error.Message, "ProjectGreed"); }
        }
    }
}
