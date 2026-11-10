"""CUTDIRECTOR's Windows bridge for the pinned Easy Jianying compiler."""
import csv
import ctypes
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


class Rejected(Exception):
    def __init__(self, code):
        self.code = code


def check(condition, code):
    if not condition:
        raise Rejected(code)


def read_json(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def write_json(file, value):
    with file.open("x", encoding="utf-8", newline="\n") as out:
        json.dump(value, out, ensure_ascii=False)
        out.flush()
        os.fsync(out.fileno())


def sha256(file):
    digest = hashlib.sha256()
    with file.open("rb") as content:
        for chunk in iter(lambda: content.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_editor(exe):
    check(os.name == "nt" and exe.is_file() and exe.name.lower() == "jianyingpro.exe",
          "EDITOR_UNAVAILABLE")
    version = ctypes.windll.version
    size = version.GetFileVersionInfoSizeW(str(exe), None)
    check(size, "EDITOR_UNVERIFIED")
    buffer = ctypes.create_string_buffer(size)
    check(version.GetFileVersionInfoW(str(exe), 0, size, buffer), "EDITOR_UNVERIFIED")
    pointer = ctypes.c_void_p()
    length = ctypes.c_uint()
    check(version.VerQueryValueW(buffer, "\\", ctypes.byref(pointer), ctypes.byref(length))
          and length.value >= 16, "EDITOR_UNVERIFIED")
    fixed = ctypes.cast(pointer, ctypes.POINTER(ctypes.c_uint32))
    major_minor, build_patch = fixed[2], fixed[3]
    actual = (major_minor >> 16, major_minor & 65535, build_patch >> 16, build_patch & 65535)
    check(actual == (11, 7, 0, 14652), "EDITOR_UNVERIFIED")
    return ".".join(map(str, actual))


def require_closed():
    tasklist = str(Path(os.environ["SystemRoot"]) / "System32/tasklist.exe")
    result = subprocess.run([tasklist, "/FI", "IMAGENAME eq JianyingPro.exe", "/FO", "CSV", "/NH"],
                            capture_output=True, check=True, timeout=10,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    check(not any(row and row[0].lower() == "jianyingpro.exe" for row in csv.reader(
        result.stdout.decode("mbcs", errors="replace").splitlines())), "EDITOR_OPEN")


def library(root):
    index = root / "root_meta_info.json"
    check(index.is_file() and not index.is_symlink(), "DRAFT_LIBRARY_UNAVAILABLE")
    try:
        raw = index.read_bytes()
        value = json.loads(raw.decode("utf-8-sig"))
        check(isinstance(value["all_draft_store"], list) and type(value["draft_ids"]) is int and
              Path(value["root_path"]).resolve() == root, "DRAFT_LIBRARY_UNSUPPORTED")
        check(all(Path(row["draft_json_file"]).name in {"draft_content.json", "draft_info.json"}
                  for row in value["all_draft_store"]), "DRAFT_LIBRARY_UNSUPPORTED")
    except (ValueError, KeyError, TypeError):
        raise Rejected("DRAFT_LIBRARY_UNSUPPORTED")
    return index, raw, value


def inspect_target(root, name, job_id, entries):
    target = root / name
    entry = next((row for row in entries if row.get("draft_name") == name), None)
    if entry is None:
        return None
    try:
        marker = read_json(target / ".cutdirector-handoff.json")
        valid = marker == {"id": job_id, "draftId": entry["draft_id"]} and (
            Path(entry["draft_json_file"]).resolve() == target / "draft_content.json")
    except (OSError, ValueError, KeyError, TypeError):
        valid = False
    check(valid and (target / "draft_content.json").is_file(), "DRAFT_NAME_CONFLICT")
    return {"name": name, "draftId": entry["draft_id"]}


def publish(config, job, root, target, index, raw, previous):
    work = Path(job["work"]).resolve(strict=True)
    sources = work / "inputs"
    os.environ["JYR_HOME"] = str(work / "jyr-config")
    os.environ["PATH"] = str(Path(config["ffprobe"]).parent) + os.pathsep + os.environ.get("PATH", "")
    sys.path.insert(0, str(Path(config["jyr"]).resolve(strict=True)))
    from jyr import home, plan, runtime, writer

    class WindowsRuntime(runtime.Runtime):
        @property
        def platform(self):
            return {**super().platform, "os": "windows"}

    manifest = job["manifest"]
    for source in manifest["files"]:
        file = (sources / source["path"]).resolve(strict=True)
        check(file.is_relative_to(sources) and sha256(file) == source["sha256"], "HANDOFF_MEDIA_CHANGED")

    built = work / "built"
    register = work / "registration"
    register.mkdir()
    rt = WindowsRuntime(Path(config["editor"]), "11.7.0", "14652", register, work / "cache",
                        runtime.KNOWN_VERSIONS["11.7.0"])
    spec = {**manifest["plan"], "name": target.name}
    compiler = plan.Compiler(rt, base_dir=sources)
    draft = compiler.compile(spec)
    writer.write(rt, draft, built, pack=True)
    write_json(register / home.INDEX, {"all_draft_store": [], "draft_ids": 0})
    # The original publisher runs against an isolated index. Its macOS process check
    # is replaced by an explicit Windows check before writing the real library.
    home.app_running = lambda _: False
    generated = home.publish(rt, built, target.name)
    intermediate = Path(generated["folder"])

    def relocate(value):
        if isinstance(value, str):
            return value.replace(str(intermediate), str(target)).replace(str(register), str(root))
        if isinstance(value, list):
            return [relocate(item) for item in value]
        if isinstance(value, dict):
            return {key: relocate(item) for key, item in value.items()}
        return value

    entry = relocate(read_json(register / home.INDEX)["all_draft_store"][0])
    entry["draft_json_file"] = str(target / "draft_content.json")
    updated = {**previous, "all_draft_store": [entry, *previous["all_draft_store"]],
               "draft_ids": previous["draft_ids"] + 1}
    stage = Path(tempfile.mkdtemp(prefix=".cutdirector-stage-", dir=root))
    index_temp = root / (".cutdirector-index-" + job["id"])
    try:
        shutil.copytree(intermediate, stage, dirs_exist_ok=True)
        for file in [stage / "draft_meta_info.json", *stage.rglob("draft_info.json"),
                     *stage.rglob("draft_info.json.bak")]:
            data = json.dumps(relocate(read_json(file)), ensure_ascii=False).encode("utf-8")
            file.write_bytes(data)
            if file.name.startswith("draft_info"):
                file.with_name(file.name.replace("draft_info", "draft_content")).write_bytes(data)
        document = read_json(stage / "draft_content.json")
        check(document["duration"] == manifest["durationUs"], "DRAFT_DURATION_MISMATCH")
        check([len(track["segments"]) for track in document["tracks"]] ==
              [len(track["clips"]) for track in spec["tracks"]], "DRAFT_STRUCTURE_MISMATCH")
        for media in [*document["materials"].get("videos", []), *document["materials"].get("audios", [])]:
            relative = Path(media["path"]).relative_to(target)
            check((stage / relative).resolve(strict=True).is_relative_to(stage), "DRAFT_MEDIA_MISSING")
        write_json(stage / ".cutdirector-handoff.json", {"id": job["id"], "draftId": entry["draft_id"]})
        (work / "index.original.json").write_bytes(raw)
        write_json(index_temp, updated)
        import msvcrt
        with (root / ".cutdirector-publish.lock").open("a+b") as lock:
            if not lock.tell():
                lock.write(b"0")
                lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                raise Rejected("DRAFT_WRITER_BUSY")
            try:
                require_closed()
                check(index.read_bytes() == raw and not target.exists(), "DRAFT_LIBRARY_CHANGED")
                stage.rename(target)
                try:
                    require_closed()
                    check(index.read_bytes() == raw, "DRAFT_LIBRARY_CHANGED")
                    os.replace(index_temp, index)
                except Rejected:
                    target.rename(stage)
                    raise
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
    finally:
        index_temp.unlink(missing_ok=True)
        if stage.exists() and stage.parent.resolve() == root:
            shutil.rmtree(stage)
    result = inspect_target(root, target.name, job["id"], read_json(index)["all_draft_store"])
    check(result is not None, "DRAFT_REGISTRATION_UNCERTAIN")
    return result


def main(operation, config, job):
    version = check_editor(Path(config["editor"]))
    raw_root = Path(config["draftRoot"])
    check(raw_root.is_dir(), "DRAFT_LIBRARY_UNAVAILABLE")
    root = raw_root.resolve(strict=True)
    index, raw, previous = library(root)
    if operation == "probe":
        check(Path(config["jyr"], "jyr", "plan.py").is_file() and Path(config["ffprobe"]).is_file()
              and Path(config["ffprobe"]).with_name("ffmpeg.exe").is_file(), "DRAFT_RUNTIME_UNAVAILABLE")
        require_closed()
        return {"version": version, "target": str(root)}
    check(Path(job["target"]).resolve() == root and job["editorVersion"] == version, "DRAFT_TARGET_CHANGED")
    name = job["name"]
    check(name == "CUTDIRECTOR-" + job["id"], "DRAFT_NAME_CONFLICT")
    existing = inspect_target(root, name, job["id"], previous["all_draft_store"])
    if operation == "status" or existing:
        return existing
    require_closed()
    target = root / name
    check(not target.exists(), "DRAFT_NAME_CONFLICT")
    return publish(config, job, root, target, index, raw, previous)


if __name__ == "__main__":
    try:
        operation, config_path = sys.argv[1:]
        request = read_json(Path(config_path))
        print(json.dumps({"data": main(operation, request["config"], request.get("job"))}, ensure_ascii=False))
    except Rejected as error:
        print(json.dumps({"error": error.code}))
    except Exception:
        print(json.dumps({"error": "DRAFT_TOOL_FAILED"}))
