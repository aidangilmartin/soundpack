using System.Reflection;
using CodeWalker.GameFiles;

namespace GunpackBridge;

/// <summary>
/// Rebuilds the game's audio archives (WEAPONS_PLAYER.rpf, RESIDENT.rpf) with replaced sound banks,
/// as fresh OPEN (unencrypted) archives: the format mod folders (FiveM's mods folder, OpenIV's mods
/// folder) load. Every other file is copied over decrypted, so nothing depends on the game's NG keys.
/// </summary>
public static class RpfBuild
{
    /// <summary>Wave packs that live in their own archive under x64\audio\sfx.</summary>
    static readonly Dictionary<string, string> PackArchives = new(StringComparer.OrdinalIgnoreCase)
    {
        ["weapons_player"] = "WEAPONS_PLAYER.rpf",
        ["resident"] = "RESIDENT.rpf"
    };

    public sealed record BuiltArchive(string Pack, string File, string Path, int Files, long Size, List<string> Replaced);
    public sealed record BuildError(string Pack, string File, string Error);

    public static object Run(Options o)
    {
        var root = Path.GetFullPath(o.Require("gta"));
        var outDir = Path.GetFullPath(o.Require("out"));
        var info = Commands.OpenGameInfo(o, root);

        var errors = new List<BuildError>();
        var replacements = new Dictionary<string, Dictionary<string, byte[]>>(StringComparer.OrdinalIgnoreCase);
        foreach (var spec in o.All("bank"))
        {
            var eq = spec.IndexOf('=');
            if (eq < 0) throw new BridgeException("usage", $"--bank expects <pack>/<bank>=<file>, got '{spec}'.");
            var key = spec[..eq].Replace('\\', '/').ToLowerInvariant();
            var slash = key.IndexOf('/');
            var pack = slash < 0 ? key : key[..slash];
            var bank = slash < 0 ? "" : key[(slash + 1)..];
            if (!PackArchives.ContainsKey(pack))
            {
                errors.Add(new BuildError(pack, bank, "Only weapons_player and resident banks can be packed into WEAPONS_PLAYER.rpf / RESIDENT.rpf."));
                continue;
            }
            if (!replacements.TryGetValue(pack, out var banks)) replacements[pack] = banks = new(StringComparer.OrdinalIgnoreCase);
            banks[bank] = File.ReadAllBytes(spec[(eq + 1)..]);
        }

        Directory.CreateDirectory(outDir);
        var built = new List<BuiltArchive>();
        foreach (var (pack, banks) in replacements)
        {
            var source = FindSourceArchive(root, pack);
            var names = source.AllEntries!.OfType<RpfFileEntry>().Select(e => e.NameLower).ToHashSet();
            foreach (var missing in banks.Keys.Where(b => !names.Contains(b)).ToList())
            {
                errors.Add(new BuildError(pack, missing, $"{missing} is not in the game's {PackArchives[pack]}."));
                banks.Remove(missing);
            }
            built.Add(Rebuild(source, Path.Combine(outDir, PackArchives[pack]), pack, banks));
        }
        return new { game = info, archives = built, errors };
    }

    /// <summary>The archive the game actually loads: a copy inside update.rpf wins over x64\audio\sfx.</summary>
    static RpfFile FindSourceArchive(string root, string pack)
    {
        var name = PackArchives[pack];
        var archives = new List<RpfFile>();
        if (Commands.FindPath(root, "update", "update.rpf") is { } update) archives.Add(Commands.Scan(update, @"update\update.rpf"));
        if (Commands.FindPath(root, "x64", "audio", "sfx", name) is { } path) archives.Add(Commands.Scan(path, @"x64\audio\sfx\" + name));
        var suffix = @"x64\audio\sfx\" + name.ToLowerInvariant();
        var candidates = archives.SelectMany(Commands.Flatten)
            .Where(r => r.Path.Replace('/', '\\').EndsWith(suffix, StringComparison.OrdinalIgnoreCase) && r.AllEntries != null)
            .ToList();
        return candidates.FirstOrDefault(r => r.Path.StartsWith("update", StringComparison.OrdinalIgnoreCase))
            ?? candidates.FirstOrDefault()
            ?? throw new BridgeException("no-banks", $@"{name} was not found under x64\audio\sfx. Is this a complete GTA V install?");
    }

    static BuiltArchive Rebuild(RpfFile source, string outPath, string pack, Dictionary<string, byte[]> banks)
    {
        var name = Path.GetFileName(outPath);
        if (File.Exists(outPath)) File.Delete(outPath);
        var dst = CreateArchive(outPath, @"x64\audio\sfx\" + name);

        var dirs = new Dictionary<RpfDirectoryEntry, RpfDirectoryEntry> { [source.Root] = dst.Root };
        RpfDirectoryEntry DirFor(RpfDirectoryEntry d)
        {
            if (dirs.TryGetValue(d, out var made)) return made;
            var parent = DirFor(d.Parent ?? source.Root);
            return dirs[d] = RpfFile.CreateDirectory(parent, d.Name);
        }

        var files = source.AllEntries!.OfType<RpfFileEntry>().ToList();
        var replaced = new List<string>();
        var n = 0;
        foreach (var entry in source.AllEntries!)
        {
            if (entry is RpfDirectoryEntry d)
            {
                DirFor(d);
                continue;
            }
            if (entry is not RpfFileEntry f) continue;
            n++;
            Output.Progress($"Rebuilding {name} ({n}/{files.Count})");
            byte[] data;
            if (banks.TryGetValue(f.NameLower, out var replacement))
            {
                data = replacement;
                replaced.Add(f.NameLower);
            }
            else
            {
                data = source.ExtractFile(f) ?? throw new BridgeException("rpf", $"Could not read {f.Path} from the game: {Commands.FirstLineOf(source.LastError)}");
                if (f is RpfResourceFileEntry res) data = ResourceBuilder.AddResourceHeader(res, ResourceBuilder.Compress(data));
            }
            RpfFile.CreateFile(DirFor(f.Parent ?? source.Root), f.Name, data);
        }

        Verify(source, outPath, name, banks);
        return new BuiltArchive(pack, name, outPath, files.Count, new FileInfo(outPath).Length, replaced);
    }

    /// <summary>Re-reads the new archive: same files, and the replaced banks byte for byte.</summary>
    static void Verify(RpfFile source, string outPath, string name, Dictionary<string, byte[]> banks)
    {
        Output.Progress($"Checking {name}");
        var check = Commands.Scan(outPath, @"x64\audio\sfx\" + name);
        var want = source.AllEntries!.OfType<RpfFileEntry>().Select(e => e.Path[(source.Root.Path.Length)..].ToLowerInvariant()).OrderBy(p => p).ToList();
        var got = check.AllEntries!.OfType<RpfFileEntry>().Select(e => e.Path[(check.Root.Path.Length)..].ToLowerInvariant()).OrderBy(p => p).ToList();
        if (!want.SequenceEqual(got)) throw new BridgeException("rpf", $"The rebuilt {name} doesn't contain the same files as the original.");
        foreach (var entry in check.AllEntries!.OfType<RpfFileEntry>())
        {
            if (!banks.TryGetValue(entry.NameLower, out var expected)) continue;
            var actual = check.ExtractFile(entry);
            if (actual == null || !actual.AsSpan().SequenceEqual(expected))
                throw new BridgeException("rpf", $"{entry.NameLower} didn't survive the rebuild of {name}.");
        }
    }

    /// <summary>New, empty OPEN archive. (RpfFile.CreateNew joins paths with '\', so do its work here to stay portable.)</summary>
    public static RpfFile CreateArchive(string path, string relPath)
    {
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
}
