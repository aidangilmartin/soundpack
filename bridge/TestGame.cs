using System.Reflection;
using CodeWalker.GameFiles;

namespace GunpackBridge;

/// <summary>
/// Builds a fake GTA V folder with unencrypted ("OPEN") archives holding the given banks, so the
/// extraction path can be tested without game files. Optionally AWC-encrypts banks with a test key.
/// </summary>
public static class TestGame
{
    public static object Make(Options o)
    {
        var root = Path.GetFullPath(o.Require("out"));
        var sfx = Path.Combine(root, "x64", "audio", "sfx");
        Directory.CreateDirectory(sfx);
        File.WriteAllBytes(Path.Combine(root, "gta5.exe"), [0x4d, 0x5a]);
        if (o.Get("test-awc-key") is { } key) Commands.UseTestAwcKey(key);

        var made = new List<string>();
        foreach (var (pack, option) in new[] { ("weapons_player", "weapons-player-awc"), ("resident", "resident-awc") })
        {
            var files = o.All(option);
            if (files.Count == 0) continue;
            var path = Path.Combine(sfx, pack.ToUpperInvariant() + ".rpf");
            var rpf = CreateArchive(path, @"x64\audio\sfx\" + pack.ToUpperInvariant() + ".rpf");
            foreach (var file in files)
            {
                var data = File.ReadAllBytes(file);
                if (o.Get("test-awc-key") != null) data = Encrypt(data, Path.GetFileName(file), o.Flag("whole-file"));
                RpfFile.CreateFile(rpf.Root, Path.GetFileName(file).ToLowerInvariant(), data);
                made.Add($"{pack}/{Path.GetFileName(file).ToLowerInvariant()}");
            }
        }
        return new { root, banks = made };
    }

    static RpfFile CreateArchive(string path, string relPath)
    {
        // RpfFile.CreateNew joins paths with '\', so do its work here to stay portable.
        File.Create(path).Dispose();
        var rpf = new RpfFile(path, relPath);
        var write = typeof(RpfFile).GetMethod("WriteNewArchive", BindingFlags.NonPublic | BindingFlags.Instance)
            ?? throw new MissingMethodException("RpfFile.WriteNewArchive");
        using (var fs = File.Open(path, FileMode.Open, FileAccess.ReadWrite))
        using (var bw = new BinaryWriter(fs))
        {
            write.Invoke(rpf, [bw, RpfEncryption.OPEN]);
        }
        return rpf;
    }

    static byte[] Encrypt(byte[] data, string name, bool wholeFile)
    {
        var awc = new AwcFile();
        awc.Load(data, new RpfBinaryFileEntry { Name = name, NameLower = name.ToLowerInvariant() });
        if (wholeFile) awc.WholeFileEncrypted = true;
        else awc.SingleChannelEncryptFlag = true;
        awc.BuildStreamInfos();
        return awc.Save();
    }
}
