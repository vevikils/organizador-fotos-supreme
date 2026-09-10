using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace OrganizadorFotos
{
    static class Program
    {
        static void Log(string msg)
        {
            try
            {
                string logPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launcher_run.log");
                File.AppendAllText(logPath, string.Format("[{0}] {1}\r\n", DateTime.Now.ToString("o"), msg));
            }
            catch {}
        }

        [STAThread]
        static void Main()
        {
            try
            {
                Log("=== Organizador_Fotos.exe iniciado ===");
                string appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
                string cliJs = Path.Combine(appDir, "node_modules", "electron", "cli.js");
                Log("cliJs=" + cliJs);

                if (!File.Exists(cliJs))
                {
                    MessageBox.Show(
                        "No se encontró 'node_modules/electron/cli.js'.\nAsegúrese de no mover este ejecutable fuera de la carpeta de la aplicación.",
                        "Organizador Supremo de Fotos",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return;
                }

                string nodeExe = "node.exe";
                string pfNode = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
                if (File.Exists(pfNode))
                {
                    nodeExe = pfNode;
                }
                Log("nodeExe=" + nodeExe);

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = string.Format("\"{0}\" .", cliJs);
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                Log("Iniciando proc.Start...");
                Process proc = new Process();
                proc.StartInfo = psi;
                proc.OutputDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("[OUT] " + e.Data); };
                proc.ErrorDataReceived += (s, e) => { if (!string.IsNullOrEmpty(e.Data)) Log("[ERR] " + e.Data); };

                proc.Start();
                Log(string.Format("proc.Start exitoso, PID={0}", proc.Id));

                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                proc.WaitForExit();
                Log("proc terminó con ExitCode=" + proc.ExitCode);
            }
            catch (Exception ex)
            {
                Log("EXCEPCION: " + ex.ToString());
                MessageBox.Show(
                    "Error al iniciar el Organizador Supremo de Fotos:\n" + ex.Message,
                    "Organizador Supremo de Fotos",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
