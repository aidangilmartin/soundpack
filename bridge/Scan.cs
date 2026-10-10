using System.Reflection;
using System.Text;
using System.Xml;
using CodeWalker.GameFiles;

namespace GunpackBridge;

/// <summary>
/// One pass over the game that builds the weapon index: every gun from weapons.meta, its audio
/// settings (player and NPC variants) and the full sound graph behind each part, plus the banks those
/// sounds live in, which are extracted unencrypted for the template library. It also writes the sound
/// usage map (see <see cref="SoundUsage"/>): what every stream in WEAPONS_PLAYER and RESIDENT is for.
/// </summary>
public static class GameScan
{
    /// <summary>weapons.meta groups that are guns.</summary>
    static readonly HashSet<string> GunGroups =
    [
        "GROUP_PISTOL", "GROUP_SMG", "GROUP_RIFLE", "GROUP_MG", "GROUP_SHOTGUN", "GROUP_SNIPER", "GROUP_HEAVY", "GROUP_STUNGUN"
    ];

    /// <summary>Known ItemAudioSettings category names, to label variants when the hash matches.</summary>
    static readonly string[] CategoryNames =
        ["player", "npc", "default", "ped", "mp", "multiplayer", "sp", "singleplayer", "fps", "player_fps", "cop", "army", "ai", "driveby"];

    /// <summary>WeaponSettings fields that keep the short role keys the app has always used.</summary>
    static readonly Dictionary<string, string> ShortRoles = new()
    {
        ["FireSound"] = "fire",
        ["AutoSound"] = "auto",
        ["SuppressedFireSound"] = "suppressed",
        ["ReportSound"] = "report",
        ["EchoSound"] = "echo",
        ["SuppressedEchoSound"] = "suppressedEcho",
        ["ShellCasingSound"] = "shellCasing",
        ["InteriorShotSound"] = "interior"
    };

    static readonly PropertyInfo[] WeaponSoundFields = typeof(Dat151WeaponSettings)
        .GetProperties(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
        .Where(p => p.PropertyType == typeof(MetaHash))
        .ToArray();

    public sealed record ScanResult(Commands.GameInfo Game, string IndexPath, string MapPath, List<Commands.ExtractedBank> Extracted,
        List<Commands.BankError> Errors, int Weapons, List<string> Warnings);

    sealed record Container(string Pack, string Bank, RpfFile Rpf, RpfFileEntry Entry);
    sealed record WeaponInfo(string Name, string Group, string Audio, string HumanName, float TimeBetweenShots, string FireType);

    public static ScanResult Run(Options o)
    {
        var root = Path.GetFullPath(o.Require("gta"));
        var outDir = Path.GetFullPath(o.Require("out"));
        var info = Commands.OpenGameInfo(o, root);
        Commands.EnsureNames(o.Get("names"));
        var warnings = new List<string>();

        var archives = OpenArchives(root);
        var all = archives.SelectMany(Commands.Flatten).ToList();

        Output.Progress("Indexing sound banks");
        var containers = new Dictionary<uint, Container>();
        foreach (var rpf in all)
        {
            // banks live directly in ...\sfx\<pack>.rpf
            var parent = Path.GetFileName(Path.GetDirectoryName(rpf.Path.Replace('\\', '/')) ?? "");
            if (!string.Equals(parent, "sfx", StringComparison.OrdinalIgnoreCase) || rpf.AllEntries == null) continue;
            var pack = Path.GetFileNameWithoutExtension(rpf.NameLower);
            foreach (var entry in rpf.AllEntries.OfType<RpfFileEntry>().Where(e => e.NameLower.EndsWith(".awc")))
            {
                var bank = entry.NameLower;
                containers[Hash($"{pack}/{bank[..^4]}")] = new Container(pack, bank, rpf, entry);
            }
        }

        Output.Progress("Reading weapon definitions");
        var allWeapons = ReadWeapons(all, warnings);
        var weapons = allWeapons.Values.Where(w => GunGroups.Contains(w.Group)).ToDictionary(w => w.Name, StringComparer.OrdinalIgnoreCase);
        Output.Progress("Reading weapon names");
        var text = ReadText(all, allWeapons.Values.Select(w => w.HumanName).Where(n => n.Length > 0).ToHashSet());

        Output.Progress("Reading audio metadata");
        var (game, sounds) = ReadRel(all, warnings);

        Output.Progress("Resolving weapon sounds");
        var nodes = new Dictionary<uint, object>();
        var usedContainers = new HashSet<uint>();
        var missingContainers = new HashSet<uint>();
        var weaponList = new List<object>();
        foreach (var w in weapons.Values.OrderBy(w => w.Group).ThenBy(w => w.Name))
        {
            if (!game.TryGetValue(Hash(w.Audio), out var item) || item is not Dat151ItemAudioSettings audioItem)
            {
                warnings.Add($"{w.Name}: audio item {w.Audio} not found.");
                continue;
            }
            var variants = new List<object>();
            var seen = new HashSet<uint>();
            void AddVariant(uint category, uint settingsHash)
            {
                if (settingsHash == 0 || !seen.Add(settingsHash)) return;
                if (!game.TryGetValue(settingsHash, out var sd) || sd is not Dat151WeaponSettings ws) return;
                var roles = RolesOf(ws, sounds);
                foreach (var h in roles.Values) Walk(h, sounds, nodes, containers, usedContainers, missingContainers);
                variants.Add(new
                {
                    category = CategoryName(category),
                    settings = settingsHash,
                    roles,
                    reportVolumeDelta = ws.ReportVolumeDelta,
                    reportPredelayDelta = ws.ReportPredelayDelta,
                    tailEnergy = ws.TailEnergyValue
                });
            }
            foreach (var it in audioItem.Weapons ?? []) AddVariant(it.Category, it.Weapon);
            AddVariant(0, audioItem.FallBackWeapon);
            if (variants.Count == 0)
            {
                warnings.Add($"{w.Name}: no weapon audio settings found.");
                continue;
            }
            weaponList.Add(new
            {
                name = w.Name,
                displayName = text.TryGetValue(w.HumanName, out var dn) ? dn : null,
                group = w.Group,
                audio = w.Audio,
                timeBetweenShots = w.TimeBetweenShots,
                fireType = w.FireType,
                variants
            });
        }
        if (missingContainers.Count > 0) warnings.Add($"{missingContainers.Count} sound containers referenced by guns were not found in the game files.");

        Output.Progress("Extracting sound banks");
        var extracted = new List<Commands.ExtractedBank>();
        var errors = new List<Commands.BankError>();
        foreach (var c in usedContainers.Select(h => containers[h]).DistinctBy(c => $"{c.Pack}/{c.Bank}"))
        {
            try
            {
                extracted.Add(Commands.ExtractBank(c.Pack, c.Rpf, c.Entry, outDir));
            }
            catch (Exception e)
            {
                errors.Add(new Commands.BankError(c.Pack, c.Bank, e.Message));
            }
        }

        var index = new
        {
            version = 2,
            game = info,
            weapons = weaponList,
            nodes,
            containers = usedContainers.ToDictionary(h => h.ToString(), h => new { pack = containers[h].Pack, bank = containers[h].Bank }),
            warnings
        };
        Directory.CreateDirectory(outDir);
        var indexPath = Path.Combine(outDir, "weapon-index.json");
        File.WriteAllText(indexPath, Output.Serialize(index));

        var weaponsByAudio = new Dictionary<uint, List<(string, string?)>>();
        foreach (var w in allWeapons.Values)
        {
            var h = Hash(w.Audio);
            if (!weaponsByAudio.TryGetValue(h, out var list)) weaponsByAudio[h] = list = [];
            list.Add((w.Name, text.TryGetValue(w.HumanName, out var dn) ? dn : null));
        }
        var mapBanks = SoundUsage.MapPacks.SelectMany(pack => BanksOf(all, pack)).ToList();
        var mapWarnings = new List<string>();
        var mapPath = SoundUsage.Write(new SoundUsage.Context
        {
            Sounds = sounds,
            Game = game,
            Banks = mapBanks,
            Archives = all,
            WeaponsByAudio = weaponsByAudio,
            CategoryName = CategoryName
        }, outDir, mapWarnings);
        warnings.AddRange(mapWarnings);
        return new ScanResult(info, indexPath, mapPath, extracted, errors, weaponList.Count, warnings);
    }

    /// <summary>
    /// The banks of a wave pack, from the same archive the export rebuilds: the copy in update.rpf
    /// when there is one, otherwise x64\audio\sfx\&lt;PACK&gt;.rpf.
    /// </summary>
    static IEnumerable<SoundUsage.BankRef> BanksOf(List<RpfFile> all, string pack)
    {
        var suffix = @"x64\audio\sfx\" + Commands.ArchiveName(pack).ToLowerInvariant();
        var candidates = all.Where(r => r.AllEntries != null && r.Path.Replace('/', '\\').EndsWith(suffix, StringComparison.OrdinalIgnoreCase)).ToList();
        var rpf = candidates.FirstOrDefault(r => r.Path.StartsWith("update", StringComparison.OrdinalIgnoreCase))
            ?? candidates.FirstOrDefault(r => r.Path.StartsWith("x64", StringComparison.OrdinalIgnoreCase));
        if (rpf == null) yield break;
        foreach (var entry in rpf.AllEntries!.OfType<RpfFileEntry>().Where(e => e.NameLower.EndsWith(".awc")))
            yield return new SoundUsage.BankRef(pack, entry.NameLower, rpf, entry);
    }

    /// <summary>Every sound field a weapon setting fills in: the 8 shot parts plus handling, slow motion, melee…</summary>
    static Dictionary<string, uint> RolesOf(Dat151WeaponSettings ws, Dictionary<uint, RelData> sounds)
    {
        var roles = new Dictionary<string, uint>();
        foreach (var p in WeaponSoundFields)
        {
            var h = ((MetaHash)p.GetValue(ws)!).Hash;
            if (h == 0) continue;
            if (ShortRoles.TryGetValue(p.Name, out var key)) roles[key] = h;
            else if (sounds.ContainsKey(h)) roles[char.ToLowerInvariant(p.Name[0]) + p.Name[1..]] = h;
        }
        return roles;
    }

    static uint Hash(string s) => JenkHash.GenHash(s.ToLowerInvariant());

    static string CategoryName(uint hash)
    {
        if (hash == 0) return "fallback";
        foreach (var n in CategoryNames) if (Hash(n) == hash) return n;
        return "0x" + hash.ToString("X8");
    }

    /// <summary>The archives that hold audio, weapon definitions and text. Skips the OpenIV mods folder.</summary>
    static List<RpfFile> OpenArchives(string root)
    {
        var list = new List<(int Order, string Path, string Rel)>();
        foreach (var path in Directory.EnumerateFiles(root, "*.rpf", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(root, path).Replace('/', '\\');
            var lower = rel.ToLowerInvariant();
            if (lower.StartsWith(@"mods\")) continue;
            int order;
            // x64?.rpf hold the animations whose tags trigger some weapon sounds (reloads, handling)
            if (lower == "common.rpf" || IsX64Archive(lower) || lower.StartsWith(@"x64\audio\")) order = 0;
            else if (lower == @"update\update.rpf") order = 1;
            else if (lower.Contains(@"dlcpacks\") && lower.EndsWith(@"\dlc.rpf")) order = 2;
            else continue;
            list.Add((order, path, rel));
        }
        var result = new List<RpfFile>();
        foreach (var (_, path, rel) in list.OrderBy(x => x.Order).ThenBy(x => x.Rel, StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                result.Add(Commands.Scan(path, rel));
            }
            catch (BridgeException) when (!rel.StartsWith(@"x64\audio", StringComparison.OrdinalIgnoreCase))
            {
                // an unreadable DLC archive shouldn't stop the scan
            }
        }
        return result;
    }

    static bool IsX64Archive(string lower) => lower.Length == 8 && lower.StartsWith("x64") && char.IsLetter(lower[3]) && lower.EndsWith(".rpf");

    static Dictionary<string, WeaponInfo> ReadWeapons(List<RpfFile> archives, List<string> warnings)
    {
        var weapons = new Dictionary<string, WeaponInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (var rpf in archives)
        {
            foreach (var entry in rpf.AllEntries?.OfType<RpfFileEntry>() ?? [])
            {
                var n = entry.NameLower;
                if (!n.StartsWith("weapon") || !n.EndsWith(".meta") || n.Contains("component") || n.Contains("archetype") || n.Contains("anim"))
                    continue;
                try
                {
                    var data = rpf.ExtractFile(entry);
                    if (data == null) continue;
                    var xml = MetaText(entry, data);
                    if (xml == null || !xml.Contains("CWeaponInfoBlob")) continue;
                    var doc = new XmlDocument();
                    doc.LoadXml(xml);
                    foreach (XmlNode node in doc.SelectNodes("//Item[@type='CWeaponInfo']")!)
                    {
                        var name = node["Name"]?.InnerText.Trim() ?? "";
                        var group = node["Group"]?.InnerText.Trim() ?? "";
                        var audio = node["Audio"]?.InnerText.Trim() ?? "";
                        if (name.Length == 0 || audio.Length == 0) continue;
                        float.TryParse(node["TimeBetweenShots"]?.Attributes?["value"]?.Value, System.Globalization.NumberStyles.Float,
                            System.Globalization.CultureInfo.InvariantCulture, out var tbs);
                        weapons[name] = new WeaponInfo(name, group, audio, node["HumanNameHash"]?.InnerText.Trim() ?? "", tbs,
                            node["FireType"]?.InnerText.Trim() ?? "");
                    }
                }
                catch (Exception e)
                {
                    warnings.Add($"{entry.Path}: {e.Message}");
                }
            }
        }
        return weapons;
    }

    /// <summary>.meta files are usually XML text; binary (PSO/RBF) ones are converted with CodeWalker.</summary>
    static string? MetaText(RpfFileEntry entry, byte[] data)
    {
        var start = data.Length >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF ? 3 : 0;
        var firstChar = data.Skip(start).SkipWhile(b => b is (byte)' ' or (byte)'\r' or (byte)'\n' or (byte)'\t').FirstOrDefault();
        if (firstChar == (byte)'<') return Encoding.UTF8.GetString(data, start, data.Length - start);
        try
        {
            return MetaXml.GetXml(entry, data, out _);
        }
        catch
        {
            return null;
        }
    }

    static Dictionary<string, string> ReadText(List<RpfFile> archives, HashSet<string> labels)
    {
        var byHash = new Dictionary<uint, string>();
        foreach (var l in labels)
        {
            byHash[JenkHash.GenHash(l.ToLowerInvariant())] = l;
            byHash[JenkHash.GenHash(l)] = l;
        }
        var result = new Dictionary<string, string>();
        foreach (var rpf in archives)
        {
            if (!rpf.Path.Contains("american")) continue;
            foreach (var entry in rpf.AllEntries?.OfType<RpfFileEntry>() ?? [])
            {
                if (!entry.NameLower.EndsWith(".gxt2")) continue;
                try
                {
                    var gxt = new Gxt2File();
                    gxt.Load(rpf.ExtractFile(entry), entry);
                    foreach (var e in gxt.TextEntries ?? [])
                    {
                        if (byHash.TryGetValue(e.Hash, out var label) && !string.IsNullOrWhiteSpace(e.Text)) result[label] = e.Text;
                    }
                }
                catch
                {
                    // ignore unreadable text files
                }
            }
        }
        return result;
    }

    static (Dictionary<uint, RelData> Game, Dictionary<uint, RelData> Sounds) ReadRel(List<RpfFile> archives, List<string> warnings)
    {
        // later archives (update, DLC) override earlier ones, as in CodeWalker's GameFileCache
        var files = new Dictionary<string, (RpfFile Rpf, RpfFileEntry Entry)>();
        foreach (var rpf in archives)
        {
            foreach (var entry in rpf.AllEntries?.OfType<RpfFileEntry>() ?? [])
            {
                var n = entry.NameLower;
                if (n.EndsWith(".rel") && (n.Contains(".dat54") || n.Contains(".dat151"))) files[n] = (rpf, entry);
            }
        }
        var game = new Dictionary<uint, RelData>();
        var sounds = new Dictionary<uint, RelData>();
        foreach (var (rpf, entry) in files.Values)
        {
            try
            {
                var rel = new RelFile();
                rel.Load(rpf.ExtractFile(entry), entry);
                var target = rel.RelType == RelDatFileType.Dat54DataEntries ? sounds : rel.RelType == RelDatFileType.Dat151 ? game : null;
                if (target == null) continue;
                foreach (var rd in rel.RelDatas ?? []) target[rd.NameHash] = rd;
            }
            catch (Exception e)
            {
                warnings.Add($"{entry.Path}: {e.Message}");
            }
        }
        return (game, sounds);
    }

    /// <summary>Emits the sound graph under `hash` (breadth-first, each node once).</summary>
    static void Walk(uint hash, Dictionary<uint, RelData> sounds, Dictionary<uint, object> nodes, Dictionary<uint, Container> containers,
        HashSet<uint> usedContainers, HashSet<uint> missingContainers)
    {
        var queue = new Queue<uint>([hash]);
        while (queue.Count > 0)
        {
            var h = queue.Dequeue();
            if (h == 0 || nodes.ContainsKey(h)) continue;
            if (!sounds.TryGetValue(h, out var rd) || rd is not Dat54Sound s)
            {
                nodes[h] = new { type = "Missing" };
                continue;
            }
            if (s is Dat54SimpleSound ss)
            {
                uint c = ss.ContainerName;
                if (containers.ContainsKey(c)) usedContainers.Add(c);
                else missingContainers.Add(c);
            }
            nodes[h] = SoundUsage.Node(s);
            var children = SoundUsage.ChildrenOf(s).Where(c => c != 0);
            foreach (var c in children) queue.Enqueue(c);
        }
    }
}
