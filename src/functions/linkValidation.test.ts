import { describe, expect, test } from "bun:test";
import { blurFileName } from "./linkValidation";

describe("blurFileName", () => {
    test("masks all but the first character and the extension", () => {
        expect(blurFileName("movie.mp4")).toBe("m****.mp4");
        expect(blurFileName("Big.Buck.Bunny.2008.mkv")).toBe("B******************.mkv");
    });

    test("masks names without an extension", () => {
        expect(blurFileName("unknown")).toBe("u******");
    });

    test("keeps single-character base names intact", () => {
        expect(blurFileName("a.mp4")).toBe("a.mp4");
        expect(blurFileName("a")).toBe("a");
    });

    test("treats a leading dot as part of the base name", () => {
        expect(blurFileName(".mp4")).toBe(".***");
    });
});
