# QR-Codify
All in one QR Codes solution


# View it here in Vercel

<a href='https://qr-codify.vercel.app/'>

```
https://qr-codify.vercel.app/
```
</a>

# Api usage

Try the api demo here

<a href='https://blazeinferno64.github.io/jolt.html?code=%2F%2F%20REST%20API%20%E2%80%94%20no%20auth%2C%20no%20SDK%20needed%0A%2F%2F%20Rate%20limit%3A%2045%20requests%2Fmin%20per%20IP%0A%0Aconst%20response%20%3D%20await%20fetch(%27https%3A%2F%2Fqr-codify.vercel.app%2Fapi%2Fgenerate%27%2C%20%7B%0A%20%20method%3A%20%27POST%27%2C%0A%20%20headers%3A%20%7B%20%27Content-Type%27%3A%20%27application%2Fjson%27%20%7D%2C%0A%20%20body%3A%20JSON.stringify(%7B%0A%20%20%20%20data%3A%20%27Powered%20by%20QR%20Codify.%20Visit%20-%20https%3A%2F%2Fqr-codify.vercel.app%20for%20more%20info!%27%2C%20%2F%2F%20Replace%20with%20your%20desired%20data%0A%20%20%20%20theme%3A%20%27cyber%27%2C%20%20%2F%2F%20%27cyber%27%20%7C%20%27tokyonight%27%20%7C%20%27neon%27%0A%20%20%20%20size%3A%20600%2C%20%20%20%20%20%20%20%2F%2F%20pixels%2C%20100%E2%80%931000%0A%20%20%20%20%2F%2F%20banner%3A%20%27data%3Aimage%2Fpng%3Bbase64%2C%3Cyour_base64_here%3E%27%0A%20%20%7D)%0A%7D)%3B%0Aconst%20imageBlob%20%3D%20await%20response.blob()%3B%0Aconst%20imageUrl%20%3D%20URL.createObjectURL(imageBlob)%3B%0Aconsole.log(%27QR%20code%20URL%3A%27%2C%20imageUrl)%3B%0Awindow.open(imageUrl)%3B&run=true'>
Jolt code snippet
</a>

# LICENSE

`QR Codify` is released under the MIT License.

View the full license terms <a href="https://github.com/BlazeInferno64/QR-Codify/blob/main/LICENSE">here</a>.

# Bugs & Issues

Found a bug or want a new feature?

Report issues and request features on the [QR-Codify issue tracker](https://github.com/blazeinferno64/QR-Codify/issues).

`Thanks for reading!`

`Have a great day ahead :D`
