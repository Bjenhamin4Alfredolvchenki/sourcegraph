import { LoadingSpinner } from '@sourcegraph/react-loading-spinner'
import * as H from 'history'
import React, { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Form } from '../components/Form'
import { eventLogger } from '../tracking/eventLogger'
import { getReturnTo, PasswordInput } from './SignInSignUpCommon'
import { ErrorAlert } from '../components/alerts'
import { asError } from '../../../shared/src/util/errors'
import { stripURLParameters } from '../tracking/analyticsUtils'

interface Props {
    location: H.Location
    history: H.History
}

/**
 * The form for signing in with a username and password.
 *
 *
 * NOTES:
 * Validation: make sure the inputs pass LOCAL validation first. cancel
 * outbound validation requests upon any input, and don't send another
 * request if the input doesn't pass local validation
 */
export const UsernamePasswordSignInForm: React.FunctionComponent<Props> = ({ location, history }) => {
    const [usernameOrEmail, setUsernameOrEmail] = useState('')
    const [password, setPassword] = useState('')
    const [authError, setAuthError] = useState<Error | null>(() => {
        // Display 3rd party auth errors (redirect with param 'auth_error')
        const authErrorMessage = new URLSearchParams(location.search).get('auth_error')
        stripURLParameters(window.location.href, ['auth_error'])
        return authErrorMessage ? new Error(authErrorMessage) : null
    })

    // global loading... need separate loading trackers for async validation
    const [loading, setLoading] = useState(false)

    const onUsernameOrEmailFieldChange = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
        setUsernameOrEmail(event.target.value)
    }, [])

    const onPasswordFieldChange = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
        setPassword(event.target.value)
    }, [])

    const handleSubmit = useCallback(
        (event: React.FormEvent<HTMLFormElement>): void => {
            event.preventDefault()
            if (loading) {
                return
            }

            setLoading(true)
            eventLogger.log('InitiateSignIn')
            fetch('/-/sign-in', {
                credentials: 'same-origin',
                method: 'POST',
                headers: {
                    ...window.context.xhrHeaders,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: usernameOrEmail,
                    password,
                }),
            })
                .then(response => {
                    if (response.status === 200) {
                        if (new URLSearchParams(location.search).get('close') === 'true') {
                            window.close()
                        } else {
                            const returnTo = getReturnTo(location)
                            window.location.replace(returnTo)
                        }
                    } else if (response.status === 401) {
                        throw new Error('User or password was incorrect')
                    } else {
                        throw new Error('Unknown Error')
                    }
                })
                .catch(error => {
                    console.error('Auth error:', error)
                    setLoading(false)
                    setAuthError(asError(error))
                })
        },
        [usernameOrEmail, loading, location, password]
    )

    return (
        <>
            <Form className="" onSubmit={handleSubmit}>
                {authError && <ErrorAlert className="my-2" error={authError} icon={false} history={history} />}
                <div className="form-group d-flex flex-column align-content-start">
                    <label className="align-self-start">Username or email</label>
                    <input
                        className="form-control signin-signup-form__input"
                        type="text"
                        onChange={onUsernameOrEmailFieldChange}
                        required={true}
                        value={usernameOrEmail}
                        disabled={loading}
                        autoCapitalize="off"
                        autoFocus={true}
                        autoComplete="username email"
                    />
                </div>
                <div className="form-group d-flex flex-column align-content-start">
                    <div className="d-flex justify-content-between">
                        <label className="">Password</label>
                        {window.context.resetPasswordEnabled && (
                            <small className="form-text text-muted">
                                <Link to="/password-reset">Forgot password?</Link>
                            </small>
                        )}
                    </div>
                    <PasswordInput
                        className="signin-signup-form__input"
                        onChange={onPasswordFieldChange}
                        value={password}
                        required={true}
                        disabled={loading}
                        autoComplete="current-password"
                    />
                </div>
                <div className="form-group">
                    <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
                        {loading ? <LoadingSpinner className="icon-inline" /> : 'Sign in'}
                    </button>
                </div>
                {/* {loading && (
                    <div className="w-100 text-center mb-2">
                        <LoadingSpinner className="icon-inline" />
                    </div>
                )} */}
            </Form>
        </>
    )
}
