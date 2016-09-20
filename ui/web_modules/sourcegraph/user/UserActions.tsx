import {Settings} from "sourcegraph/user";

export type Action =
	SubmitBetaSubscription |
	BetaSubscriptionCompleted |
	UpdateSettings;

export class SubmitBetaSubscription {
	email: string;
	firstName: string;
	lastName: string;
	languages: string[];
	editors: string[];
	message: string;
	// eventName purposefully left out

	constructor(email: string, firstName: string, lastName: string, languages: string[], editors: string[], message: string) {
		this.email = email;
		this.firstName = firstName;
		this.lastName = lastName;
		this.languages = languages;
		this.editors = editors;
		this.message = message;
	}
}

export class BetaSubscriptionCompleted {
	resp: any;
	eventName: string;

	constructor(resp: any) {
		this.resp = resp;
		this.eventName = "BetaSubscriptionCompleted";
	}
}

export class UpdateSettings {
	settings: Settings;

	constructor(settings: Settings) {
		this.settings = settings;
	}
}
