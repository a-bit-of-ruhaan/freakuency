import assert from "node:assert/strict";
import test from "node:test";
import { archiveAudioUrl, audioMimeType, isAllowedArchiveLicense, isPlayableArchiveAudio, isSafeArchiveAudioUrl, selectArchiveAudioFile } from "./archive-license.js";

test("allows recognized Creative Commons and public-domain licenses only", () => {
  assert.equal(isAllowedArchiveLicense("https://creativecommons.org/licenses/by/4.0/"), true);
  assert.equal(isAllowedArchiveLicense("https://creativecommons.org/licenses/by-sa/3.0"), true);
  assert.equal(isAllowedArchiveLicense("https://creativecommons.org/publicdomain/zero/1.0/"), true);
  assert.equal(isAllowedArchiveLicense("https://creativecommons.org/licenses/by-nc/4.0/"), false);
  assert.equal(isAllowedArchiveLicense("https://example.org/license"), false);
  assert.equal(isAllowedArchiveLicense(undefined), false);
});

test("selects supported audio files and prefers broadly supported formats", () => {
  const selected = selectArchiveAudioFile([
    { name: "cover.jpg", size: "1000" },
    { name: "album.flac", size: "2000" },
    { name: "track.mp3", size: "1500" },
    { name: "private.mp3", size: "1200", private: "true" },
    { name: "folder/hidden.mp3", size: "1000" },
    { name: "empty.ogg", size: "0" },
  ]);
  assert.deepEqual(selected, { name: "track.mp3", size: "1500" });
  assert.equal(audioMimeType("track.mp3"), "audio/mpeg");
  assert.equal(audioMimeType("track.exe"), null);
});

test("limits proxied audio URLs to HTTPS Internet Archive hosts", () => {
  assert.equal(isSafeArchiveAudioUrl(archiveAudioUrl("public-item", "track name.mp3")), true);
  assert.equal(isSafeArchiveAudioUrl("http://archive.org/audio.mp3"), false);
  assert.equal(isSafeArchiveAudioUrl("https://archive.org.example.com/audio.mp3"), false);
});

test("only marks complete, allowlisted archive sources as playable", () => {
  assert.equal(isPlayableArchiveAudio({
    archiveIdentifier: "public-item",
    archiveFileName: "track.mp3",
    audioLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  }), true);
  assert.equal(isPlayableArchiveAudio({
    archiveIdentifier: "public-item",
    archiveFileName: "../track.mp3",
    audioLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  }), false);
  assert.equal(isPlayableArchiveAudio({
    archiveIdentifier: null,
    archiveFileName: null,
    audioLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  }), false);
});
