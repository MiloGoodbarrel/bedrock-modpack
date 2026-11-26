"""Draws the question-board tile icons (our own pixel art, no external assets).

Each question gets a 16x16 tile in its category's colour with a white glyph, scaled up 4x to 64x64 so it stays
crisp, plus a dimmed "_used" version for questions already asked this round.

    python tools/make_question_icons.py

Writes resource_packs/modpack_rp/textures/ui/hs_questions/<id>.png and <id>_used.png. Pure Python (no PIL).
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "resource_packs", "modpack_rp", "textures", "ui", "hs_questions")

COLORS = {
    "comparing": (150, 52, 186),
    "distance": (52, 120, 210),
    "observation": (46, 168, 72),
    "task": (210, 182, 44),
}

# 10x10 glyphs: "#" = white pixel.
G = {
    "arrows_ns": [
        "....##....", "...####...", "..######..", "....##....", "....##....",
        "....##....", "....##....", "..######..", "...####...", "....##....",
    ],
    "arrows_ew": [
        "..........", "..........", "..#....#..", ".##....##.", "##########",
        "##########", ".##....##.", "..#....#..", "..........", "..........",
    ],
    "updown": [
        "....##....", "...####...", "..######..", "....##....", "##########",
        "##########", "....##....", "..######..", "...####...", "....##....",
    ],
    "tree": [
        "...####...", "..######..", ".########.", ".########.", "..######..",
        "...####...", "....##....", "....##....", "....##....", "..######..",
    ],
    "cube": [
        "...######.", "..#....##.", ".#....#.#.", "######..#.", "#....#..#.",
        "#....#..#.", "#....#.#..", "#....##...", "######....", "..........",
    ],
    "paw": [
        ".##....##.", ".##....##.", "..........", "##..##..##", "##..##..##",
        "..........", "...####...", "..######..", "..######..", "...####...",
    ],
    "sun": [
        "#...##...#", ".#..##..#.", "..######..", ".########.", "##########",
        "##########", ".########.", "..######..", ".#..##..#.", "#...##...#",
    ],
    "leaf": [
        "......####", "....######", "...####.##", "..####.###", ".####.####",
        ".###.####.", ".##.####..", ".#.####...", "#.........", "#.........",
    ],
    "drop": [
        "....##....", "....##....", "...####...", "...####...", "..######..",
        ".########.", ".######.#.", ".#####.##.", "..######..", "...####...",
    ],
    "flame": [
        "....#.....", "....##....", "...###.#..", "...####.#.", "..######.#",
        ".########.", ".###..###.", ".##....##.", "..##..##..", "...####...",
    ],
    "snow": [
        "....##....", ".#..##..#.", "..#.##.#..", "...####...", "##########",
        "##########", "...####...", "..#.##.#..", ".#..##..#.", "....##....",
    ],
    "flower": [
        "...#..#...", "..##..##..", "...####...", "..##..##..", "...#..#...",
        "....##....", "..#.##....", "...###....", "....##....", "....##....",
    ],
    "cloud": [
        "..........", "...###....", "..#####...", ".#######..", "##########",
        "##########", ".########.", "..........", "..........", "..........",
    ],
    "pickaxe": [
        "..######..", ".#......#.", "#...##...#", "....##....", "....##....",
        "....##....", "....##....", "....##....", "....##....", "....##....",
    ],
    "block": [
        "##########", "#........#", "#........#", "#........#", "#........#",
        "#........#", "#........#", "#........#", "#........#", "##########",
    ],
    "grass": [
        "##########", "##########", "#.#.#.#.##", "#........#", "#........#",
        "#........#", "#........#", "#........#", "#........#", "##########",
    ],
    "gravel": [
        "##########", "#.#....#.#", "#...##...#", "#.#....#.#", "#....#...#",
        "#.##...#.#", "#.....#..#", "#..#.....#", "#.#..#.#.#", "##########",
    ],
    "sand": [
        "##########", "#........#", "#.#.#.#..#", "#........#", "#..#.#.#.#",
        "#........#", "#.#.#.#..#", "#........#", "#..#.#.#.#", "##########",
    ],
    "stone": [
        "##########", "#........#", "#.##.....#", "#.##..##.#", "#.....##.#",
        "#..##....#", "#..##..#.#", "#.......##", "#........#", "##########",
    ],
    "fireball": [
        "...####...", "..#.##.#..", ".#.####.#.", "#.######.#", "#########.",
        ".#########", "#.######.#", ".#.####.#.", "..#.##.#..", "...####...",
    ],
    "rocket": [
        "....##....", "...####...", "...####...", "...#..#...", "...####...",
        "...####...", "..######..", ".##.##.##.", "....##....", "...#..#...",
    ],
    "drop_block": [
        "....##....", "....##....", "..######..", "...####...", "....##....",
        "..........", "##########", "#........#", "#........#", "##########",
    ],
    "my_block": [
        "##########", "#...##...#", "#...##...#", "#...##...#", "#...##...#",
        "#...##...#", "#........#", "#...##...#", "#........#", "##########",
    ],
    "egg_b": [
        "...####...", "..#....#..", ".#.###..#.", ".#.#..#.#.", "#..###...#",
        "#..#..#..#", "#..###...#", ".#......#.", "..#....#..", "...####...",
    ],
    "egg_c": [
        "...####...", "..#....#..", ".#..###.#.", ".#.#....#.", "#..#.....#",
        "#..#.....#", "#...###..#", ".#......#.", "..#....#..", "...####...",
    ],
    "egg_m": [  # cow
        "...####...", "..#....#..", ".#......#.", ".#.#...#.#", "#..##.##.#",
        "#..#.#.#.#", "#..#...#.#", ".#......#.", "..#....#..", "...####...",
    ],
    "egg_p": [
        "...####...", "..#....#..", ".#.###..#.", ".#.#..#.#.", "#..###...#",
        "#..#.....#", "#..#.....#", ".#......#.", "..#....#..", "...####...",
    ],
    "egg_r": [
        "...####...", "..#....#..", ".#.###..#.", ".#.#..#.#.", "#..###...#",
        "#..#.#...#", "#..#..#..#", ".#......#.", "..#....#..", "...####...",
    ],
}


def circle(radius):
    """A ring of the given radius on the 10x10 glyph grid (for the distance questions)."""
    rows = []
    for y in range(10):
        row = ""
        for x in range(10):
            d = ((x - 4.5) ** 2 + (y - 4.5) ** 2) ** 0.5
            row += "#" if abs(d - radius) < 0.7 else "."
        rows.append(row)
    return rows


ICONS = {
    # comparing
    "north_south": ("comparing", G["arrows_ns"]),
    "east_west": ("comparing", G["arrows_ew"]),
    "above_below": ("comparing", G["updown"]),
    "same_biome": ("comparing", G["tree"]),
    "same_block": ("comparing", G["cube"]),
    "same_nearest_mob": ("comparing", G["paw"]),
    # distance: smaller rings for smaller distances
    "within_500": ("distance", circle(4.4)),
    "within_250": ("distance", circle(3.5)),
    "within_100": ("distance", circle(2.6)),
    "within_50": ("distance", circle(1.7)),
    "within_25": ("distance", circle(0.9)),
    # observation
    "block_light": ("observation", G["sun"]),
    "on_leaves": ("observation", G["leaf"]),
    "water_near": ("observation", G["drop"]),
    "lava_near": ("observation", G["flame"]),
    "snow_near": ("observation", G["snow"]),
    "flowers_near": ("observation", G["flower"]),
    "sky_visible": ("observation", G["cloud"]),
    # task
    "task_break": ("task", G["pickaxe"]),
    "task_grass": ("task", G["grass"]),
    "task_gravel": ("task", G["gravel"]),
    "task_sand": ("task", G["sand"]),
    "task_stone": ("task", G["stone"]),
    "task_bee": ("task", G["egg_b"]),
    "task_chicken": ("task", G["egg_c"]),
    "task_cow": ("task", G["egg_m"]),
    "task_pig": ("task", G["egg_p"]),
    "task_rabbit": ("task", G["egg_r"]),
    "task_fire": ("task", G["fireball"]),
    "task_firework": ("task", G["rocket"]),
    "task_drop_floor": ("task", G["drop_block"]),
    "task_my_block": ("task", G["my_block"]),
}


def tile(color, glyph, used):
    """16x16 RGBA pixels: shaded tile with a 1px darker edge and the glyph in the middle."""
    r, g, b = color
    if used:
        r, g, b = (int(c * 0.38) + 18 for c in (r, g, b))
    fg = (120, 120, 120, 255) if used else (255, 255, 255, 255)
    edge = tuple(int(c * 0.6) for c in (r, g, b)) + (255,)
    light = tuple(min(255, int(c * 1.15) + 10) for c in (r, g, b)) + (255,)
    px = []
    for y in range(16):
        row = []
        for x in range(16):
            if x in (0, 15) or y in (0, 15):
                row.append(edge)
            elif y == 1 or x == 1:
                row.append(light)
            else:
                row.append((r, g, b, 255))
        px.append(row)
    for gy, line in enumerate(glyph):
        for gx, ch in enumerate(line):
            if ch == "#":
                px[3 + gy][3 + gx] = fg
    return px


def write_png(path, px, scale=4):
    h = len(px) * scale
    w = len(px[0]) * scale
    raw = bytearray()
    for row in px:
        line = bytearray([0])
        for p in row:
            line += bytes(p) * scale
        raw += bytes(line) * scale
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT, exist_ok=True)
    for qid, (cat, glyph) in ICONS.items():
        assert len(glyph) == 10 and all(len(r) == 10 for r in glyph), qid
        write_png(os.path.join(OUT, f"{qid}.png"), tile(COLORS[cat], glyph, False))
        write_png(os.path.join(OUT, f"{qid}_used.png"), tile(COLORS[cat], glyph, True))
    print(f"wrote {len(ICONS) * 2} icons to {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
