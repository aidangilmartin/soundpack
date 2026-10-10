using System.Reflection;
using System.Runtime.Loader;

namespace GunpackBridge;

/// <summary>
/// Resolves CodeWalker.Core.dll and its dependencies (SharpDX) from the user's CodeWalker folder.
/// Must run before any method that touches CodeWalker types is JIT-compiled.
/// </summary>
public static class CodeWalkerLoader
{
    public static string Folder { get; private set; } = "";
    public static Version? CoreVersion { get; private set; }

    public static void Install(string folder)
    {
        var full = Path.GetFullPath(folder);
        var core = Path.Combine(full, "CodeWalker.Core.dll");
        if (!File.Exists(core))
        {
            throw new BridgeException("no-codewalker",
                $"CodeWalker.Core.dll was not found in \"{full}\". Select the folder you extracted CodeWalker into.");
        }
        Folder = full;
        try
        {
            CoreVersion = AssemblyName.GetAssemblyName(core).Version;
        }
        catch (BadImageFormatException)
        {
            throw new BridgeException("no-codewalker", $"\"{core}\" isn't a valid CodeWalker.Core.dll. Re-download CodeWalker and select its folder.");
        }
        AssemblyLoadContext.Default.Resolving += (context, name) =>
        {
            var path = Path.Combine(full, name.Name + ".dll");
            return File.Exists(path) ? context.LoadFromAssemblyPath(path) : null;
        };
    }
}
