"""
Fix no-empty and no-empty-function violations by adding /* empty */ comments.
- Empty catch blocks: catch (_) {} -> catch (_) { /* empty */ }
- Empty arrow functions passed as callbacks: () => {} -> () => { /* noop */ }
Only touches obvious patterns; skips anything complex.
"""
import re, os

# Files with no-empty violations (from lint output)
files = [
    r"src\components\auth\PasskeySetupPrompt.tsx",
    r"src\components\auth\PasskeySignInPage.tsx",
    r"src\components\auth\PasswordLoginPanel.tsx",
    r"src\components\auth\TotpSetupPanel.tsx",
    r"src\components\auth\TwoFactorVerifyPanel.tsx",
    r"src\components\auth\api.ts",
    r"src\components\nav\TicketsPanel.ts",
    r"src\components\nav\badgeSync.ts",
    r"src\components\nav\navCore.ts",
    r"src\components\sections\Finance\FinanceApprovalActionModal.tsx",
    r"src\components\sections\Finance\FinanceApprovalsInbox.tsx",
    r"src\components\sections\Finance\FinanceExportDialog.tsx",
    r"src\components\sections\Finance\FinanceKpiDrilldownDrawer.tsx",
    r"src\components\sections\Finance\StatNewVersionPage.tsx",
    r"src\components\sections\Finance\hrfinFormat.ts",
    r"src\components\sections\HR\ActionDialogs.tsx",
    r"src\components\sections\HR\CreateEmployeeWizard.tsx",
    r"src\components\sections\HSE\HSESection.tsx",
    r"src\components\sections\Profile\MyProfileSection.tsx",
    r"src\components\sections\ProjectSites\ProjectSitesSection.tsx",
    r"src\components\sections\Tickets\TicketPanel.tsx",
    r"src\components\shared\Avatar.tsx",
    r"src\components\shared\ConfirmDialog.tsx",
    r"src\hooks\useRealtimeSignals.ts",
    r"src\hooks\useStepUp.tsx",
    r"src\lib\charts.ts",
    r"src\lib\navVisibility.ts",
    r"src\ui\examples\ThemeEditor.tsx",
    r"src\ui\examples\UIKitPage.tsx",
    r"src\components\livemap\LiveMapModule.ts",
    r"src\lib\attSystem.ts",
    r"src\lib\cache.ts",
    r"src\lib\api.ts",
    r"src\lib\apiLegacy.ts",
    r"src\lib\navVisibility.ts",
    r"src\lib\popup.ts",
]

total_fixed = 0

for rel in files:
    if not os.path.exists(rel):
        continue
    with open(rel, 'r', encoding='utf-8', newline='') as fh:
        content = fh.read()

    orig = content

    # Pattern 1: Empty catch blocks with a variable: } catch (e) {} or } catch (_) {}
    # Replace {} with { /* empty */ }
    content = re.sub(
        r'(\}\s*catch\s*\([^)]*\)\s*)\{\s*\}',
        r'\1{ /* empty */ }',
        content
    )

    # Pattern 2: Empty catch blocks without variable (ES2019): } catch {}
    content = re.sub(
        r'(\}\s*catch\s*)\{\s*\}',
        r'\1{ /* empty */ }',
        content
    )

    # Pattern 3: Inline empty arrow functions used as no-op callbacks
    # e.g., onClose={() => {}}  onChange={() => {}}  onClick={() => {}}
    # Only replace single-use inline pattern like: => {}  at end of attribute/arg
    content = re.sub(
        r'(=>\s*)\{\s*\}',
        r'\1{ /* noop */ }',
        content
    )

    if content != orig:
        with open(rel, 'w', encoding='utf-8', newline='') as fh:
            fh.write(content)
        n = content.count('/* empty */') + content.count('/* noop */')
        orig_n = orig.count('/* empty */') + orig.count('/* noop */')
        added = n - orig_n
        total_fixed += added
        print(f'Fixed {added} in {rel.split(chr(92))[-1]}')

print(f'Total: {total_fixed} empty-block comments added')
