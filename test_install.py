"""
Setup verification script for MeetFlow.
Run this after installing requirements to confirm everything is working.
"""

import sys


def check_package(package_name: str, import_name: str = None) -> bool:
    import_name = import_name or package_name
    try:
        __import__(import_name)
        print(f"  [OK] {package_name}")
        return True
    except ImportError:
        print(f"  [MISSING] {package_name} — run: pip install {package_name}")
        return False


def check_src_modules() -> bool:
    try:
        from src.parser import TranscriptParser
        from src.classifier import MeetingClassifier
        print("  [OK] src.parser")
        print("  [OK] src.classifier")
        return True
    except ImportError as e:
        print(f"  [ERROR] Could not import src modules: {e}")
        return False


def main():
    print("=== MeetFlow Installation Check ===\n")

    print("Checking Python version...")
    major, minor = sys.version_info[:2]
    if major == 3 and minor >= 9:
        print(f"  [OK] Python {major}.{minor}")
    else:
        print(f"  [WARN] Python {major}.{minor} — Python 3.9+ recommended")

    print("\nChecking required packages...")
    packages = [
        ("torch", "torch"),
        ("transformers", "transformers"),
        ("datasets", "datasets"),
        ("scikit-learn", "sklearn"),
        ("numpy", "numpy"),
        ("pandas", "pandas"),
        ("tqdm", "tqdm"),
    ]
    results = [check_package(name, imp) for name, imp in packages]

    print("\nChecking src modules...")
    src_ok = check_src_modules()

    print("\n=== Summary ===")
    if all(results) and src_ok:
        print("All checks passed. MeetFlow is ready to use.")
    else:
        print("Some checks failed. See above for details.")


if __name__ == "__main__":
    main()
