#!/usr/bin/env python3
"""Extract local persona dossier text from PDF and DOCX files.

This script only uses files already present in the repository.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import zlib
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
DOSSIER_DIR = ROOT / "data" / "dossiers"

PERSONAS = [
    {
        "id": "pa01",
        "slug": "council_tax_payer",
        "sources": [
            ROOT / "Council-tax-payer" / "VOA council tax payer for AI personas.pdf",
        ],
    },
    {
        "id": "pa02",
        "slug": "integrated_agent",
        "sources": [
            ROOT / "Integrated-agent" / "VOA Customer Insight Integrated Agent.pdf",
        ],
    },
    {
        "id": "pa03",
        "slug": "landlord",
        "sources": [
            ROOT / "Landlord" / "VOA Customer Insight landlords.pdf",
        ],
    },
    {
        "id": "pa04",
        "slug": "local_authority",
        "sources": [
            ROOT / "Local-authority" / "VOA Customer Insight Local Authority.pdf",
        ],
    },
    {
        "id": "pa05",
        "slug": "professional_agent",
        "sources": [
            ROOT / "Professional-agent" / "VOA Customer Insight Agent subset for AI personas.pdf",
            ROOT / "Professional-agent" / "VOA agent questionnaire 001 GERALDEVE - REDACTED.docx",
            ROOT / "Professional-agent" / "VOA agent questionnaire 001 HASLAMS - REDACTED.docx",
            ROOT / "Professional-agent" / "VOA agent questionnaire 001 JLL - REDACTED.docx",
            ROOT / "Professional-agent" / "VOA agent questionnaire 001 VAIL WILLIAMS - REDACTED.docx",
        ],
    },
    {
        "id": "pa06",
        "slug": "sme",
        "sources": [
            ROOT / "SME" / "VOA Customer Insight SME.pdf",
        ],
    },
    {
        "id": "pa07",
        "slug": "volume_agent",
        "sources": [
            ROOT / "Volume-agent" / "VOA Customer Insight volume agent.pdf",
        ],
    },
]


def decode_pdf_literal(value: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(value):
        char = value[i]
        if char != "\\":
            out.append(char)
            i += 1
            continue

        i += 1
        if i >= len(value):
            break

        escaped = value[i]
        simple = {
            "n": "\n",
            "r": "\r",
            "t": "\t",
            "b": "\b",
            "f": "\f",
            "(": "(",
            ")": ")",
            "\\": "\\",
        }
        if escaped in simple:
            out.append(simple[escaped])
            i += 1
            continue

        if escaped.isdigit():
            octal = escaped
            for _ in range(2):
                if i + 1 < len(value) and value[i + 1].isdigit():
                    i += 1
                    octal += value[i]
                else:
                    break
            try:
                out.append(chr(int(octal, 8)))
            except ValueError:
                pass
            i += 1
            continue

        out.append(escaped)
        i += 1

    return "".join(out)


def decode_pdf_hex(value: str) -> str:
    if len(value) % 2 == 1:
        value = value + "0"

    try:
        raw = bytes.fromhex(value)
    except ValueError:
        return ""

    if b"\x00" in raw:
        try:
            return raw.decode("utf-16-be", errors="ignore")
        except UnicodeDecodeError:
            pass

    return raw.decode("latin-1", errors="ignore")


PDF_TOKEN = re.compile(r"\((?:\\.|[^\\])*\)|<[0-9A-Fa-f]+>|-?\d+(?:\.\d+)?")


def parse_tj_array(value: str) -> str:
    parts: list[str] = []
    for token in PDF_TOKEN.findall(value):
        if token.startswith("("):
            parts.append(decode_pdf_literal(token[1:-1]))
            continue
        if token.startswith("<"):
            parts.append(decode_pdf_hex(token[1:-1]))
            continue
        try:
            number = float(token)
        except ValueError:
            continue
        # Negative kerning values usually represent spacing between words.
        if number < -120:
            parts.append(" ")

    return "".join(parts)


def clean_segment(value: str) -> str:
    value = value.replace("\x00", "")
    value = value.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    value = (
        value.replace("Õ", "'")
        .replace("Ò", '"')
        .replace("Ó", '"')
        .replace("—", "-")
        .replace("–", "-")
    )
    value = re.sub(r"\s+", " ", value)
    value = value.strip()

    if not value:
        return ""

    if len(value) > 280 and value.count(" ") < max(2, len(value) // 25):
        return ""

    non_ascii = sum(1 for ch in value if ord(ch) > 126)
    if non_ascii / max(1, len(value)) > 0.08:
        return ""

    printable = sum(1 for ch in value if 31 < ord(ch) < 127 or ch in "\t\n\r")
    if printable / max(1, len(value)) < 0.75:
        return ""

    if not re.search(r"[A-Za-z]{2,}", value):
        return ""

    letters = sum(1 for ch in value if ch.isalpha())
    digits = sum(1 for ch in value if ch.isdigit())
    punctuation = sum(1 for ch in value if not ch.isalnum() and not ch.isspace())

    if letters / max(1, len(value)) < 0.38:
        return ""
    if digits / max(1, len(value)) > 0.24:
        return ""
    if punctuation / max(1, len(value)) > 0.34:
        return ""

    words = re.findall(r"[A-Za-z']+", value)
    long_words = [word for word in words if len(word) >= 4]
    if not long_words:
        return ""

    non_word = sum(1 for ch in value if not ch.isalnum() and not ch.isspace())
    if len(value) < 3 and non_word > 0:
        return ""

    return value


def clean_pdf_artifacts(value: str) -> str:
    # Remove common kerning markers left by PDF text extraction.
    value = re.sub(r"\)\s*-?\d+(?:\.\d+)?\s*\(", "", value)
    value = value.replace("(", "").replace(")", "")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def extract_pdf_text(path: Path) -> str:
    data = path.read_bytes()
    segments: list[str] = []

    for stream_match in re.finditer(rb"stream\r?\n", data):
        start = stream_match.end()
        end = data.find(b"endstream", start)
        if end == -1:
            continue

        raw_stream = data[start:end]
        if raw_stream.endswith(b"\r\n"):
            raw_stream = raw_stream[:-2]
        elif raw_stream.endswith(b"\n"):
            raw_stream = raw_stream[:-1]

        try:
            decoded_stream = zlib.decompress(raw_stream)
        except zlib.error:
            continue

        content = decoded_stream.decode("latin-1", errors="ignore")
        if "BT" not in content or "ET" not in content:
            continue

        # Most genuine content streams include text operators and font settings.
        if "Tf" not in content and "Tj" not in content and "TJ" not in content:
            continue

        for block in re.findall(r"BT(.*?)ET", content, flags=re.DOTALL):
            for array in re.findall(r"\[(.*?)\]\s*TJ", block, flags=re.DOTALL):
                text = clean_segment(clean_pdf_artifacts(parse_tj_array(array)))
                if text:
                    segments.append(text)

            for literal in re.findall(r"\((?:\\.|[^\\])*\)\s*Tj", block):
                text = clean_segment(clean_pdf_artifacts(decode_pdf_literal(literal[1:-4])))
                if text:
                    segments.append(text)

            for literal in re.findall(r"\((?:\\.|[^\\])*\)\s*['\"]", block):
                text = clean_segment(clean_pdf_artifacts(decode_pdf_literal(literal[1:-2])))
                if text:
                    segments.append(text)

            for hex_value in re.findall(r"<([0-9A-Fa-f]+)>\s*Tj", block):
                text = clean_segment(clean_pdf_artifacts(decode_pdf_hex(hex_value)))
                if text:
                    segments.append(text)

    deduped: list[str] = []
    seen: set[str] = set()
    for segment in segments:
        if segment in seen:
            continue
        seen.add(segment)
        deduped.append(segment)

    return "\n".join(deduped)


def extract_docx_text(path: Path) -> str:
    result = subprocess.run(
        ["textutil", "-convert", "txt", "-stdout", str(path)],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to convert {path}: {result.stderr.strip()}")

    lines: list[str] = []
    for raw_line in result.stdout.splitlines():
        line = clean_segment(raw_line)
        if line:
            lines.append(line)

    return "\n".join(lines)


def extract_source_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf_text(path)
    if suffix == ".docx":
        return extract_docx_text(path)
    raise ValueError(f"Unsupported file extension: {path.name}")


def write_dossier(persona: dict[str, object]) -> Path:
    persona_id = str(persona["id"])
    slug = str(persona["slug"])
    sources: Iterable[Path] = persona["sources"]  # type: ignore[assignment]

    sections: list[str] = [
        f"Persona ID: {persona_id}",
        f"Source slug: {slug}",
        "",
    ]

    for source in sources:
        if not source.exists():
            raise FileNotFoundError(f"Missing source file: {source}")

        sections.append(f"===== SOURCE: {source.relative_to(ROOT)} =====")
        extracted = extract_source_text(source)
        sections.append(extracted.strip() if extracted.strip() else "[NO EXTRACTED TEXT]")
        sections.append("")

    DOSSIER_DIR.mkdir(parents=True, exist_ok=True)
    output = DOSSIER_DIR / f"{persona_id}_{slug}.txt"
    output.write_text("\n".join(sections).strip() + "\n", encoding="utf-8")
    return output


def main() -> int:
    outputs = []
    for persona in PERSONAS:
        output = write_dossier(persona)
        outputs.append(str(output.relative_to(ROOT)))

    manifest = {
        "generated_files": outputs,
    }
    (DOSSIER_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print("Generated dossiers:")
    for output in outputs:
        print(f"- {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
