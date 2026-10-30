import {stagingEmailSuppressionReason} from './stagingEmailSafety';

export function isCommunicationDryRun():boolean {
 return process.env.COMMUNICATION_DRY_RUN?.trim().toLowerCase()==='true';
}

// Allowlisted tests never override an explicit dry-run or an inconsistent staging target.
export function communicationSendSuppressionReason():string|null {
 if(isCommunicationDryRun())return 'COMMUNICATION_DRY_RUN';
 return stagingEmailSuppressionReason();
}
