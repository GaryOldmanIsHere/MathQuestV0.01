# MathQuestV0.01
This is an LLM driven math RPG game to learn math from K-12th grade.

---

## Chocolatey Package: Poopoo

This repository also contains a Chocolatey package for Poopoo (Noah System 4.16.3.6646).

### Package Information

- **Package Name**: poopoo
- **Version**: 1.0.0
- **Tag**: PLG
- **License**: MIT
- **Installation Type**: Silent Install
- **Uninstall Support**: Full uninstall behavior

### Features

- Silent installation with no user interaction required
- Automatic download from source URL
- Full uninstall support
- Registry-based uninstall detection

### Installation

#### From GitHub (Local Build)

1. Clone this repository:
```bash
git clone https://github.com/GaryOldmanIsHere/MathQuestV0.01.git
cd MathQuestV0.01
```

2. Build the package:
```powershell
cd poopoo
choco pack
```

3. Install the package:
```powershell
choco install poopoo -s . -y
```

### Uninstallation

```powershell
choco uninstall poopoo -y
```

### Package Structure

```
poopoo/
├── poopoo.nuspec              # Package metadata and configuration
├── tools/
│   ├── chocolateyInstall.ps1   # Installation script
│   ├── chocolateyUninstall.ps1 # Uninstallation script
│   └── LICENSE.txt             # MIT License
```

### Development

#### Building the Package

To build the Chocolatey package locally:

```powershell
cd poopoo
choco pack
```

This will create a `.nupkg` file in the current directory.

#### Testing the Package

To test the package locally before distribution:

```powershell
choco install poopoo -s . -y --force
```

To test uninstallation:

```powershell
choco uninstall poopoo -y
```

### Source Information

- **Download URL**: https://himsafiles.com/Noah4downloads/Noah_System_4.16.3.6646.exe
- **Software Version**: 4.16.3.6646

### License

This package is licensed under the MIT License. See [LICENSE](LICENSE) for details.

### Notes

- This package uses silent installation with the `/S` flag
- The package downloads the installer from the official source URL
- Uninstallation is handled through Windows registry detection
- This package is intended for GitHub distribution only

### Troubleshooting

If you encounter issues:

1. Ensure Chocolatey is installed and up to date
2. Run PowerShell as Administrator
3. Check that the source URL is accessible
4. Verify no antivirus software is blocking the installation

### References

This package structure follows Chocolatey community best practices:
- [Chocolatey Package Recipes](https://github.com/chocolatey-community/chocolatey-package-recipes)
- [Chocolatey Community Packages](https://github.com/chocolatey-community/chocolatey-packages) 
