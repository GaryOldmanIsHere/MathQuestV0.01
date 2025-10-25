# Poopoo Chocolatey Package

Chocolatey package for Poopoo (Noah System 4.16.3.6646).

## Package Details

- **ID**: poopoo
- **Version**: 1.0.0
- **Tags**: poopoo, PLG
- **License**: MIT
- **Source**: https://himsafiles.com/Noah4downloads/Noah_System_4.16.3.6646.exe

## Installation

### Build and Install Locally

```powershell
# Build the package
choco pack

# Install from local .nupkg
choco install poopoo -s . -y
```

## Uninstallation

```powershell
choco uninstall poopoo -y
```

## Files

- `poopoo.nuspec` - Package manifest with metadata
- `tools/chocolateyInstall.ps1` - Installation script with silent install support
- `tools/chocolateyUninstall.ps1` - Uninstallation script
- `tools/LICENSE.txt` - MIT License

## Features

- Automatic download from source URL
- Silent installation (`/S` flag)
- Full uninstall support via registry detection
- SHA256 checksum validation (update checksum in install script for production use)

## Notes

For production use, it's recommended to:
1. Calculate and add the SHA256 checksum of the installer to `chocolateyInstall.ps1`
2. Test installation and uninstallation thoroughly
3. Verify the silent install arguments work correctly for your specific installer

## References

Based on Chocolatey community package structure guidelines.
